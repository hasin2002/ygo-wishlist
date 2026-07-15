import Image from "next/image";
import type { CSSProperties } from "react";
import styles from "./animated-card-wall.module.css";

export const cardWallImages = Array.from(
  { length: 20 },
  (_, index) => `/card-wall/card-${String(index + 1).padStart(2, "0")}.webp`,
);

export type AnimatedCardWallProps = {
  className?: string;
  columnCount?: number;
  durationSeconds?: number;
  hoverScale?: number;
  images?: readonly string[];
  paused?: boolean;
  rotationDegrees?: number;
};

type CardWallStyle = CSSProperties & {
  "--card-wall-column-count": number;
  "--card-wall-duration": string;
  "--card-wall-hover-scale": number;
  "--card-wall-play-state": "paused" | "running";
  "--card-wall-rotation": string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function AnimatedCardWall({
  className,
  columnCount = 4,
  durationSeconds = 75,
  hoverScale = 1.05,
  images = cardWallImages,
  paused = false,
  rotationDegrees = 10,
}: AnimatedCardWallProps) {
  const safeColumnCount = Math.round(clamp(columnCount, 2, 5));
  const columns = Array.from({ length: safeColumnCount }, () => [] as string[]);

  images.forEach((image, index) => {
    columns[index % safeColumnCount].push(image);
  });

  const wallStyle: CardWallStyle = {
    "--card-wall-column-count": safeColumnCount,
    "--card-wall-duration": `${clamp(durationSeconds, 15, 120)}s`,
    "--card-wall-hover-scale": clamp(hoverScale, 1, 1.1),
    "--card-wall-play-state": paused ? "paused" : "running",
    "--card-wall-rotation": `${clamp(rotationDegrees, -15, 15)}deg`,
  };

  return (
    <div
      aria-hidden="true"
      className={`${styles.wall} ${className ?? ""}`}
      style={wallStyle}
    >
      <div className={styles.canvas}>
        <div className={styles.grid}>
          {columns.map((column, columnIndex) => (
            <div className={styles.column} key={`column-${columnIndex}`}>
              <div className={styles.track}>
                {[0, 1].map((sequenceIndex) => (
                  <div
                    className={styles.sequence}
                    key={`sequence-${sequenceIndex}`}
                  >
                    {column.map((src) => (
                      <div
                        className={styles.card}
                        key={`${sequenceIndex}-${src}`}
                      >
                        <Image
                          alt=""
                          className={styles.image}
                          draggable={false}
                          height={600}
                          loading="eager"
                          sizes="(min-width: 1280px) 14vw, (min-width: 1024px) 16vw, 22vw"
                          src={src}
                          width={412}
                        />
                        <span className={styles.sheen} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
