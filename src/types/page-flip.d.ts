declare module "page-flip" {
  type FlipCorner = "top" | "bottom";

  type PageFlipEvent = {
    data: number | string | { page: number; mode: "portrait" | "landscape" };
    object: PageFlip;
  };

  type PageFlipSettings = {
    autoSize?: boolean;
    clickEventForward?: boolean;
    disableFlipByClick?: boolean;
    drawShadow?: boolean;
    flippingTime?: number;
    height: number;
    maxHeight?: number;
    maxShadowOpacity?: number;
    maxWidth?: number;
    minHeight?: number;
    minWidth?: number;
    mobileScrollSupport?: boolean;
    showCover?: boolean;
    showPageCorners?: boolean;
    size?: "fixed" | "stretch";
    startPage?: number;
    useMouseEvents?: boolean;
    usePortrait?: boolean;
    width: number;
  };

  export class PageFlip {
    constructor(element: HTMLElement, settings: PageFlipSettings);
    destroy(): void;
    flipNext(corner?: FlipCorner): void;
    flipPrev(corner?: FlipCorner): void;
    loadFromHTML(items: HTMLElement[]): void;
    on(eventName: string, callback: (event: PageFlipEvent) => void): PageFlip;
    turnToPage(pageNumber: number): void;
  }
}
