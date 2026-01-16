import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import { Position as ReactFlowPosition } from '@xyflow/react';

import type { Item, Building, ProductionNode, OrbitalCargoLauncherNode, OreQuality } from './types';
import { ORE_QUALITY_LABELS, ORE_QUALITY_RATES } from './types';
import type { Corporation, Level } from '../../state/db';
import { buildProductionFlow, getItemName } from './productionFlowBuilder';
import { ItemImage, BuildingImage } from '../ui';

export interface FlowDataGenerationParams {
    targetItemId: string;
    targetAmount: number;
    buildings: Building[];
    corporations: Corporation[];
    levels: Level[];
    items: Item[];
    getItemColor: (itemId: string) => string;
    getBuildingColor: (buildingId: string) => string;
    oreSourcesByItem: Record<string, OreQuality[]>;
    onOreQualityChange?: (itemId: string, sourceIndex: number, quality: OreQuality) => void;
    onAddOreSource?: (itemId: string) => void;
    onRemoveOreSource?: (itemId: string, sourceIndex: number) => void;
}

export interface FlowData {
    nodes: Node[];
    edges: Edge[];
}

/**
 * Converts the flow builder output to React Flow format and applies layout
 * 
 * This function:
 * 1. Builds the production flow using the separate flow builder
 * 2. Creates a Dagre graph for automatic layout
 * 3. Converts flow nodes to React Flow nodes with custom styling
 * 4. Converts flow edges to React Flow edges with labels
 * 5. Applies the calculated positions to all nodes
 */
export const generateReactFlowData = ({
    targetItemId,
    targetAmount,
    buildings,
    corporations,
    levels,
    items,
    getItemColor,
    getBuildingColor,
    oreSourcesByItem,
    onOreQualityChange,
    onAddOreSource,
    onRemoveOreSource
}: FlowDataGenerationParams): FlowData => {
    // Use fallback of 1 if amount is 0 or invalid (for temporary empty input state)
    const validAmount = targetAmount > 0 ? targetAmount : 1;

    // Build the production flow using our separate module
    const oreQualityByItem = Object.fromEntries(
        Object.entries(oreSourcesByItem).map(([itemId, sources]) => [
            itemId,
            sources[0] ?? 'normal'
        ])
    );

    const { nodes: flowNodes, edges: flowEdges } = buildProductionFlow({
        targetItemId,
        targetAmount: validAmount,
        oreQualityByItem
    }, buildings, corporations, levels);

    const expandedNodes: Array<{
        node: ProductionNode;
        originalKey: string;
        sourceIndex?: number;
        sourceCount?: number;
        sourceQuality?: OreQuality;
    }> = [];
    const nodeKeyToExpandedIndexes = new Map<string, number[]>();

    const getOreSources = (itemId: string): OreQuality[] => {
        const sources = oreSourcesByItem[itemId];
        return sources && sources.length > 0 ? sources : ['normal'];
    };

    flowNodes.forEach((node) => {
        const nodeKey = `${node.buildingId}_${node.recipeIndex}_${node.outputItem}`;
        if (node.buildingId === 'ore_excavator') {
            const sources = getOreSources(node.outputItem);
            const totalDemand = node.buildingCount * node.outputAmount;
            const share = sources.length > 0 ? 1 / sources.length : 1;

            sources.forEach((quality, sourceIndex) => {
                const outputRate = ORE_QUALITY_RATES[quality];
                const buildingCount = outputRate > 0 ? (totalDemand * share) / outputRate : 0;
                const totalPower = Math.ceil(buildingCount) * node.powerPerBuilding;

                const splitNode = {
                    ...node,
                    outputAmount: outputRate,
                    buildingCount,
                    totalPower
                };

                const expandedIndex = expandedNodes.length;
                expandedNodes.push({
                    node: splitNode,
                    originalKey: nodeKey,
                    sourceIndex,
                    sourceCount: sources.length,
                    sourceQuality: quality
                });
                const indexes = nodeKeyToExpandedIndexes.get(nodeKey) ?? [];
                indexes.push(expandedIndex);
                nodeKeyToExpandedIndexes.set(nodeKey, indexes);
            });
            return;
        }

        const expandedIndex = expandedNodes.length;
        expandedNodes.push({ node, originalKey: nodeKey });
        nodeKeyToExpandedIndexes.set(nodeKey, [expandedIndex]);
    });

    const expandedEdges: Array<{
        fromIndex: number;
        toIndex: number;
        itemId: string;
        amount: number;
    }> = [];

    flowEdges.forEach((edge) => {
        const fromIndexes = nodeKeyToExpandedIndexes.get(edge.from) ?? [];
        const toIndexes = nodeKeyToExpandedIndexes.get(edge.to) ?? [];

        if (fromIndexes.length === 0 || toIndexes.length === 0) {
            return;
        }

        const share = 1 / fromIndexes.length;
        fromIndexes.forEach((fromIndex) => {
            toIndexes.forEach((toIndex) => {
                expandedEdges.push({
                    fromIndex,
                    toIndex,
                    itemId: edge.itemId,
                    amount: edge.amount * share
                });
            });
        });
    });

    // Create Dagre graph for automatic layout
    // Dagre arranges nodes in a hierarchical layout (left-to-right)
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: 'LR', ranksep: 150, nodesep: 100 });

    // Add all nodes to the layout graph
    expandedNodes.forEach((_, index) => {
        dagreGraph.setNode(`node_${index}`, { width: 200, height: 120 });
    });

    // Add edges to define the layout relationships
    expandedEdges.forEach((edge) => {
        dagreGraph.setEdge(`node_${edge.fromIndex}`, `node_${edge.toIndex}`);
    });

    // Calculate positions using Dagre
    dagre.layout(dagreGraph);

    // Calculate total power consumption across all nodes
    const totalPowerConsumption = expandedNodes.reduce((sum, entry) => sum + entry.node.totalPower, 0);

    // Convert flow nodes to React Flow nodes with positioning and styling
    const reactFlowNodes: Node[] = expandedNodes.map(({ node, sourceIndex, sourceCount, sourceQuality }, index) => {
        const nodeWithPosition = dagreGraph.node(`node_${index}`);

        // Helper function to check if node is Orbital Cargo Launcher
        const isOrbitalCargoLauncher = (n: ProductionNode): n is OrbitalCargoLauncherNode => {
            return n.buildingId === 'orbital_cargo_launcher';
        };

        const isLauncher = isOrbitalCargoLauncher(node);
        const isOreExcavator = node.buildingId === 'ore_excavator';
        const oreQuality = isOreExcavator
            ? (sourceQuality ?? 'normal')
            : null;

        return {
            id: `node_${index}`,
            type: 'default',
            position: { x: nodeWithPosition.x - 100, y: nodeWithPosition.y - 60 },
            data: {
                label: isLauncher ? (
                    // Special rendering for Orbital Cargo Launcher
                    <div className="text-center p-2">
                        <div className="text-xs font-semibold mb-1">
                            x{node.buildingCount.toFixed(2)}
                        </div>
                        <div className="text-xs font-semibold mb-2  absolute top-[-10px] right-[-10px] bg-base-100">
                            <div className="badge badge-sm badge-outline badge-primary">
                                ⚡ {node.totalPower}
                            </div>
                        </div>
                        {/* Launcher icon - using a rocket emoji since no image yet */}
                        <div
                            className="w-20 h-20 mx-auto mb-2 rounded-full flex items-center justify-center text-3xl bg-yellow-500"
                        >
                            <BuildingImage
                                buildingId={"launcher"}
                                className="w-19 h-19 rounded-full object-cover"
                                size="medium"
                            />
                        </div>
                        {/* Launcher information */}
                        <div className="text-xs font-semibold mb-1">
                            {node.buildingName}
                        </div>
                        <div className="text-xs text-orange-500 mb-2">
                            {node.outputAmount} items/min
                        </div>
                        {/* Item and reward info */}
                        <div className="flex items-center gap-2 justify-center mb-2">
                            <div className="relative flex-shrink-0">
                                <ItemImage
                                    itemId={node.outputItem}
                                    className="border-1 shadow-sm"
                                    style={{ borderColor: getItemColor(node.outputItem) }}
                                    size="small"
                                    showFallback={false}
                                />
                            </div>
                            <div className="text-left">
                                <div className="text-xs opacity-75 leading-tight">
                                    {getItemName(node.outputItem, items)}
                                </div>
                                <div className="text-xs leading-tight text-orange-500">
                                    {node.pointsPerItem} pts/item
                                </div>
                            </div>
                        </div>
                        {/* Launch time and level cost */}
                        <div className="text-xs space-y-1">
                            <div className="text-green-500 font-semibold">
                                Level Cost: {node.totalPoints} pts
                            </div>
                            <div className="text-yellow-500 font-semibold">
                                Total Launch Time: {(node.launchTime).toFixed(1)} min
                            </div>
                            <div className="text-blue-500 font-semibold border-t border-base-300 pt-1 mt-2">
                                Total ⚡: {Math.ceil(totalPowerConsumption)}
                            </div>
                        </div>
                    </div>
                ) : (
                    // Standard rendering for production buildings
                    <div className="text-center p-2 relative">
                        <div className="text-xs font-semibold mb-1">
                            x{node.buildingCount.toFixed(2)}
                        </div>
                        {isOreExcavator && (
                            <button
                                type="button"
                                className="btn btn-xs btn-circle nodrag absolute top-1 left-1"
                                aria-label="Add ore source"
                                onClick={() => onAddOreSource?.(node.outputItem)}
                            >
                                +
                            </button>
                        )}
                        {isOreExcavator && sourceCount && sourceCount > 1 && (
                            <button
                                type="button"
                                className="btn btn-xs btn-circle nodrag absolute top-7 left-1"
                                aria-label="Remove ore source"
                                onClick={() => onRemoveOreSource?.(node.outputItem, sourceIndex ?? 0)}
                            >
                                -
                            </button>
                        )}
                        {/* Building icon */}
                        <div
                            className="w-20 h-20 mx-auto mb-2 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: getBuildingColor(node.buildingId) }}
                        >
                            <BuildingImage
                                buildingId={node.buildingId}
                                className="w-19 h-19 rounded-full object-cover"
                                size="medium"
                            />
                        </div>
                        {/* Building information */}
                        <div className="text-xs font-semibold mb-1">
                            {node.buildingName}
                        </div>
                        <div className="text-xs font-semibold mb-2  absolute top-[-10px] right-[-10px] bg-base-100">
                            <div className="badge badge-sm badge-outline badge-primary">
                                ⚡ {node.totalPower}
                            </div>
                        </div>
                        {/* Item image and info inline */}
                        <div className="flex items-center gap-2 justify-center">
                            <div className="relative flex-shrink-0">
                                <ItemImage
                                    itemId={node.outputItem}
                                    className="border-1 shadow-sm"
                                    style={{ borderColor: getItemColor(node.outputItem) }}
                                    size="small"
                                    showFallback={false}
                                />
                            </div>
                            <div className="text-left">
                                <div className="text-xs opacity-75 leading-tight">
                                    {getItemName(node.outputItem, items)}
                                </div>
                                <div className="text-xs leading-tight"
                                    style={{ color: getItemColor(node.outputItem) }}>
                                    {node.outputAmount.toFixed(1)}/min
                                </div>
                            </div>
                        </div>
                        {isOreExcavator && oreQuality && (
                            <div className="mt-2">
                                <select
                                    className="select select-xs nodrag w-full"
                                    value={oreQuality}
                                    onChange={(event) => {
                                        const value = event.target.value as OreQuality;
                                        const indexValue = sourceIndex ?? 0;
                                        onOreQualityChange?.(node.outputItem, indexValue, value);
                                    }}
                                >
                                    {Object.entries(ORE_QUALITY_LABELS).map(([value, label]) => (
                                        <option key={value} value={value}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                                {sourceCount && sourceCount > 1 && (
                                    <div className="text-[10px] text-base-content/60 mt-1">
                                        Source {((sourceIndex ?? 0) + 1)} of {sourceCount}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ),
            },
            sourcePosition: ReactFlowPosition.Right,
            targetPosition: ReactFlowPosition.Left,
        };
    });

    // Convert flow edges to React Flow edges with labels
    const reactFlowEdges: Edge[] = [];
    const edgeIdSet = new Set<string>();

    expandedEdges.forEach((edge) => {
        const fromNodeId = `node_${edge.fromIndex}`;
        const toNodeId = `node_${edge.toIndex}`;
        const edgeId = `${fromNodeId}-${toNodeId}-${edge.itemId}`;

        // Safety check: prevent duplicate React Flow edges
        if (edgeIdSet.has(edgeId)) {
            return;
        }
        edgeIdSet.add(edgeId);

        const reactFlowEdge = {
            id: edgeId,
            source: fromNodeId,
            target: toNodeId,
            type: 'default',
            style: { stroke: getItemColor(edge.itemId), strokeWidth: 2 },
            label: `${getItemName(edge.itemId, items)} (${edge.amount.toFixed(1)}/min)`,
            labelStyle: { fontSize: 12, fontWeight: 'bold', color: getItemColor(edge.itemId) },
        };
        reactFlowEdges.push(reactFlowEdge);
    });

    return {
        nodes: reactFlowNodes,
        edges: reactFlowEdges
    };
};
