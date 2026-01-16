import type { Building } from "../../state/db";

export interface BuildingImageProps {
  buildingId: string;
  building?: Building;
  className?: string;
  size?: 'small' | 'medium' | 'large';
  style?: React.CSSProperties;
}

const sizeClasses = {
  small: 'w-10 h-10',
  medium: 'w-15 h-15',
  large: 'w-30 h-30'
};

export const BuildingImage = ({ 
  buildingId, 
  building, 
  className = '', 
  size = 'large',
  style = {}
}: BuildingImageProps) => {
  const normalizedId = buildingId.includes('-') ? buildingId.replace(/-/g, '_') : buildingId.replace(/_/g, '-');
  const variants = buildingId === normalizedId ? [buildingId] : [buildingId, normalizedId];
  const candidates = variants.map(id => `/icons/buildings/${id}.jpg`);
  const imagePath = candidates[0];
  const baseClasses = `${sizeClasses[size]} object-cover rounded`;
  const finalClassName = className ? `${baseClasses} ${className}` : baseClasses;
  
  return (
    <img
      src={imagePath}
      alt={building?.name || buildingId}
      className={finalClassName}
      style={style}
      onError={(e) => {
        const target = e.target as HTMLImageElement;
        const currentIndex = Number(target.dataset.iconIndex || '0');
        const nextIndex = currentIndex + 1;
        if (nextIndex < candidates.length) {
          target.dataset.iconIndex = String(nextIndex);
          target.src = candidates[nextIndex];
          return;
        }
        target.style.display = 'none';
      }}
    />
  );
};
