"use client";

import {
  ArrowRight,
  Bold,
  ChevronDown,
  FileText,
  GripVertical,
  Italic,
  List,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  Type,
  Underline,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { trpc } from "@/trpc/client";

type Idea = { id: string; text: string; x: number; y: number };
type Connection = { from: string; id: string; to: string; type: "arrow" | "line" };
type FreeText = { id: string; text: string; x: number; y: number };
type IdeaPage = { canvasHeight: number; canvasWidth: number; connections: Connection[]; freeTexts: FreeText[]; id: string; ideas: Idea[]; title: string };
type Drag = { id: string; kind: "idea" | "text"; offsetX: number; offsetY: number };
type Linking = { from: string; x: number; y: number };
type Point = { x: number; y: number };

const initialCanvasWidth = 1500;
const initialCanvasHeight = 1000;
const canvasGrowthStep = 600;

function createId() {
  return crypto.randomUUID();
}

function samplePage(): IdeaPage {
  return {
    canvasHeight: initialCanvasHeight,
    canvasWidth: initialCanvasWidth,
    id: "feature-planning",
    title: "Feature planning",
    ideas: [
      { id: "welcome", text: "<strong>Start with a spark</strong><br>Capture an idea, then draw connections to see what belongs together.", x: 72, y: 96 },
      { id: "player", text: "<strong>Player need</strong><br>What problem does this solve?", x: 460, y: 220 },
      { id: "next", text: "<strong>Smallest next step</strong><br>What could we try first?", x: 830, y: 82 },
    ],
    connections: [
      { id: "sample-one", from: "welcome", to: "player", type: "arrow" },
      { id: "sample-two", from: "player", to: "next", type: "line" },
    ],
    freeTexts: [],
  };
}

function newPage(index: number): IdeaPage {
  return { canvasHeight: initialCanvasHeight, canvasWidth: initialCanvasWidth, connections: [], freeTexts: [], id: createId(), ideas: [], title: `Untitled page ${index}` };
}

function newIdea(x: number, y: number): Idea {
  return { id: createId(), text: "<strong>Untitled idea</strong><br>Write a little more…", x, y };
}

function canvasFromPage(page: IdeaPage) {
  return {
    canvasHeight: page.canvasHeight,
    canvasWidth: page.canvasWidth,
    connections: page.connections,
    freeTexts: page.freeTexts,
    ideas: page.ideas,
  };
}

function pageFromServer(page: { canvas: Omit<IdeaPage, "id" | "title">; id: string; title: string }): IdeaPage {
  return {
    ...page.canvas,
    canvasHeight: Math.max(page.canvas.canvasHeight, initialCanvasHeight),
    canvasWidth: Math.max(page.canvas.canvasWidth, initialCanvasWidth),
    freeTexts: page.canvas.freeTexts ?? [],
    id: page.id,
    title: page.title,
  };
}

function EditableHtml({
  className,
  html,
  onBlur,
}: {
  className: string;
  html: string;
  onBlur: (html: string) => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || document.activeElement === element) return;
    if (element.innerHTML !== html) element.innerHTML = html;
  }, [html]);

  return (
    <div
      className={className}
      contentEditable
      onBlur={(event) => onBlur(event.currentTarget.innerHTML)}
      ref={elementRef}
      suppressContentEditableWarning
    />
  );
}

function EditablePageTitle({ title, onBlur }: { title: string; onBlur: (title: string) => void }) {
  const elementRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || document.activeElement === element) return;
    if (element.textContent !== title) element.textContent = title;
  }, [title]);

  return (
    <h2
      aria-label="Page title. Click to rename."
      className="mt-1 cursor-text rounded-sm text-xl font-bold text-zinc-950 outline-none focus-visible:ring-2 focus-visible:ring-[#8a1f2d]/50"
      contentEditable
      onBlur={(event) => onBlur(event.currentTarget.textContent ?? "")}
      ref={elementRef}
      suppressContentEditableWarning
      title="Click to rename this page"
    />
  );
}

function curvePath(start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dy) < 36 && dx > 120) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  const bend = Math.max(44, Math.min(112, Math.abs(dx) * 0.26 + Math.abs(dy) * 0.1));
  const direction = dx >= 0 ? 1 : -1;
  return `M ${start.x} ${start.y} C ${start.x + bend * direction} ${start.y}, ${end.x - bend * direction} ${end.y}, ${end.x} ${end.y}`;
}

function connectionPoints(page: IdeaPage, connection: Connection) {
  const from = page.ideas.find((idea) => idea.id === connection.from);
  const to = page.ideas.find((idea) => idea.id === connection.to);
  if (!from || !to) return null;

  const outgoing = page.connections.filter((item) => item.from === connection.from);
  const incoming = page.connections.filter((item) => item.to === connection.to);
  const fromSlot = outgoing.findIndex((item) => item.id === connection.id);
  const toSlot = incoming.findIndex((item) => item.id === connection.id);
  const fromY = from.y + 42 + ((fromSlot + 1) / (outgoing.length + 1)) * 84;
  const toY = to.y + 42 + ((toSlot + 1) / (incoming.length + 1)) * 84;
  const travelsRight = to.x + 150 >= from.x + 150;

  return {
    end: { x: travelsRight ? to.x : to.x + 300, y: toY },
    start: { x: travelsRight ? from.x + 300 : from.x, y: fromY },
  };
}

export function FeatureIdeasApp() {
  const [pages, setPages] = useState<IdeaPage[]>([samplePage()]);
  const [activePageId, setActivePageId] = useState("feature-planning");
  const [databaseReady, setDatabaseReady] = useState(false);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const connectionLeaveTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const hydratedRef = useRef(false);
  const pagesQuery = trpc.featureIdeas.list.useQuery(undefined, { retry: 1 });
  const createPageMutation = trpc.featureIdeas.create.useMutation();
  const updatePageMutation = trpc.featureIdeas.update.useMutation();

  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];

  useEffect(() => {
    if (!pagesQuery.data || hydratedRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      if (hydratedRef.current) return;
      hydratedRef.current = true;
      if (pagesQuery.data.length) {
        const restoredPages = pagesQuery.data.map(pageFromServer);
        setPages(restoredPages);
        setActivePageId(restoredPages[0].id);
        setDatabaseReady(true);
        return;
      }

      const firstPage = samplePage();
      createPageMutation.mutate({ canvas: canvasFromPage(firstPage), id: firstPage.id, title: firstPage.title }, {
        onError: () => {
          hydratedRef.current = false;
        },
        onSuccess: (page) => {
          const persistedPage = pageFromServer(page);
          setPages([persistedPage]);
          setActivePageId(persistedPage.id);
          setDatabaseReady(true);
        },
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [createPageMutation, pagesQuery.data]);

  useEffect(() => {
    if (!databaseReady) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      pages.forEach((page) => updatePageMutation.mutate({
        canvas: canvasFromPage(page),
        id: page.id,
        title: page.title,
      }));
      saveTimerRef.current = null;
    }, 650);

    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [databaseReady, pages, updatePageMutation]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLinking(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => () => {
    if (connectionLeaveTimerRef.current !== null) {
      window.clearTimeout(connectionLeaveTimerRef.current);
    }
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
  }, []);

  function updatePage(update: (page: IdeaPage) => IdeaPage) {
    setPages((current) => current.map((page) => (page.id === activePage.id ? update(page) : page)));
  }

  function canvasPoint(event: { clientX: number; clientY: number }) {
    const viewport = viewportRef.current;
    const bounds = viewport?.getBoundingClientRect();
    if (!viewport || !bounds) return null;
    return {
      x: Math.max(16, Math.min(activePage.canvasWidth - 16, (event.clientX - bounds.left + viewport.scrollLeft) / zoom)),
      y: Math.max(16, Math.min(activePage.canvasHeight - 16, (event.clientY - bounds.top + viewport.scrollTop) / zoom)),
    };
  }

  function addPage() {
    const page = newPage(pages.length + 1);
    createPageMutation.mutate({ canvas: canvasFromPage(page), id: page.id, title: page.title }, {
      onSuccess: (persistedPage) => {
        const nextPage = pageFromServer(persistedPage);
        setPages((current) => [...current, nextPage]);
        setActivePageId(nextPage.id);
        setSelectedIdeaId(null);
      },
    });
  }

  function renamePage(title: string) {
    const nextTitle = title.trim() || "Untitled page";
    updatePage((page) => page.title === nextTitle ? page : { ...page, title: nextTitle });
  }

  function createIdea(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-board-interactive]")) return;
    const point = canvasPoint(event);
    if (!point) return;
    const idea = newIdea(Math.max(16, point.x - 150), Math.max(16, point.y - 42));
    updatePage((page) => ({
      ...page,
      canvasHeight: point.y > page.canvasHeight - 180 ? page.canvasHeight + canvasGrowthStep : page.canvasHeight,
      canvasWidth: point.x > page.canvasWidth - 320 ? page.canvasWidth + canvasGrowthStep : page.canvasWidth,
      ideas: [...page.ideas, idea],
    }));
    setSelectedIdeaId(idea.id);
  }

  function startCardDrag(event: React.PointerEvent<HTMLDivElement>, idea: Idea) {
    const point = canvasPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: idea.id, kind: "idea", offsetX: point.x - idea.x, offsetY: point.y - idea.y };
    setSelectedIdeaId(idea.id);
  }

  function startLink(event: React.PointerEvent<HTMLButtonElement>, idea: Idea) {
    const point = canvasPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setLinking({ from: idea.id, x: point.x, y: point.y });
    setSelectedIdeaId(idea.id);
  }

  function moveCanvas(event: React.PointerEvent<HTMLDivElement>) {
    const point = canvasPoint(event);
    if (!point) return;
    if (linking) setLinking((current) => (current ? { ...current, x: point.x, y: point.y } : null));
    if (dragRef.current) {
      const drag = dragRef.current;
      const nextX = Math.max(16, point.x - drag.offsetX);
      const nextY = Math.max(16, point.y - drag.offsetY);
      updatePage((page) => ({
        ...page,
        canvasHeight: nextY > page.canvasHeight - 220 ? page.canvasHeight + canvasGrowthStep : page.canvasHeight,
        canvasWidth: nextX > page.canvasWidth - 380 ? page.canvasWidth + canvasGrowthStep : page.canvasWidth,
        ...(drag.kind === "idea"
          ? { ideas: page.ideas.map((idea) => idea.id === drag.id ? { ...idea, x: nextX, y: nextY } : idea) }
          : { freeTexts: page.freeTexts.map((text) => text.id === drag.id ? { ...text, x: nextX, y: nextY } : text) }),
      }));
    }
  }

  function finishPointer(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (!linking) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-idea-id]")?.dataset.ideaId;
    if (target && target !== linking.from) {
      updatePage((page) => page.connections.some((connection) => connection.from === linking.from && connection.to === target) ? page : { ...page, connections: [...page.connections, { id: createId(), from: linking.from, to: target, type: "arrow" }] });
    }
    setLinking(null);
  }

  function updateText(id: string, text: string) {
    updatePage((page) => ({ ...page, ideas: page.ideas.map((idea) => idea.id === id ? { ...idea, text } : idea) }));
  }

  function addFreeText() {
    const text: FreeText = { id: createId(), text: "<strong>New heading</strong>", x: 80 + activePage.freeTexts.length * 24, y: 36 + activePage.freeTexts.length * 20 };
    updatePage((page) => ({ ...page, freeTexts: [...page.freeTexts, text] }));
  }

  function startFreeTextDrag(event: React.PointerEvent<HTMLButtonElement>, text: FreeText) {
    const point = canvasPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: text.id, kind: "text", offsetX: point.x - text.x, offsetY: point.y - text.y };
  }

  function updateFreeText(id: string, text: string) {
    updatePage((page) => ({ ...page, freeTexts: page.freeTexts.map((item) => item.id === id ? { ...item, text } : item) }));
  }

  function deleteConnection(id: string) {
    updatePage((page) => ({ ...page, connections: page.connections.filter((connection) => connection.id !== id) }));
    setHoveredConnectionId(null);
  }

  function toggleArrow(id: string) {
    updatePage((page) => ({ ...page, connections: page.connections.map((connection) => connection.id === id ? { ...connection, type: connection.type === "arrow" ? "line" : "arrow" } : connection) }));
  }

  function showConnectionControls(id: string) {
    if (connectionLeaveTimerRef.current !== null) {
      window.clearTimeout(connectionLeaveTimerRef.current);
      connectionLeaveTimerRef.current = null;
    }
    setHoveredConnectionId(id);
  }

  function hideConnectionControls(id: string) {
    if (connectionLeaveTimerRef.current !== null) {
      window.clearTimeout(connectionLeaveTimerRef.current);
    }
    connectionLeaveTimerRef.current = window.setTimeout(() => {
      setHoveredConnectionId((current) => current === id ? null : current);
      connectionLeaveTimerRef.current = null;
    }, 120);
  }

  function setZoomAround(nextZoom: number, focalPoint?: { x: number; y: number }) {
    const viewport = viewportRef.current;
    const clampedZoom = Math.max(0.5, Math.min(1.6, Math.round(nextZoom * 10) / 10));
    if (!viewport || clampedZoom === zoom) return;

    const focusX = focalPoint?.x ?? viewport.clientWidth / 2;
    const focusY = focalPoint?.y ?? viewport.clientHeight / 2;
    const worldX = (viewport.scrollLeft + focusX) / zoom;
    const worldY = (viewport.scrollTop + focusY) / zoom;

    setZoom(clampedZoom);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = worldX * clampedZoom - focusX;
      viewport.scrollTop = worldY * clampedZoom - focusY;
    });
  }

  function zoomWithWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const bounds = viewportRef.current?.getBoundingClientRect();
    setZoomAround(zoom + (event.deltaY > 0 ? -0.1 : 0.1), bounds ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top } : undefined);
  }

  function deleteIdea(id: string) {
    updatePage((page) => ({ ...page, ideas: page.ideas.filter((idea) => idea.id !== id), connections: page.connections.filter((connection) => connection.from !== id && connection.to !== id) }));
    setSelectedIdeaId(null);
  }

  function format(command: "bold" | "italic" | "underline" | "insertUnorderedList") {
    document.execCommand(command);
  }

  function resetPage() {
    updatePage((page) => ({ ...samplePage(), id: page.id, title: page.title }));
    setSelectedIdeaId(null);
    setHoveredConnectionId(null);
  }

  if (pagesQuery.isError) {
    return (
      <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <AppHeader eyebrow="Admin workspace" title="Feature ideas" />
        <section className="pt-6" aria-live="polite">
          <div className="rounded-2xl border border-rose-200 bg-white p-6 text-sm text-zinc-700 shadow-sm">
            <p className="font-bold text-zinc-950">Feature ideas could not be loaded.</p>
            <p className="mt-1">Please refresh the page. If this continues, the feature ideas table may not have been applied to the database yet.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-page-shell min-h-screen bg-[#f6f4ef] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <AppHeader eyebrow="Admin workspace" title="Feature ideas" />
      <section className="pt-6" aria-label="Feature ideas workspace">
        <div className="grid overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-sm lg:grid-cols-[235px_minmax(0,1fr)]">
          <aside className="border-b border-zinc-200 bg-[#fcfbf8] p-3 lg:border-b-0 lg:border-r" aria-label="Idea pages">
            <div className="mb-3 flex items-center justify-between px-2 pt-1"><p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Pages</p><button aria-label="Create page" className="idea-toolbar-button disabled:cursor-not-allowed disabled:opacity-50" disabled={createPageMutation.isPending} onClick={addPage} title="Create page" type="button"><Plus className="size-4" /></button></div>
            <div className="flex gap-1 overflow-x-auto lg:flex-col">
              {pages.map((page) => <button className={`flex min-h-11 min-w-44 items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold transition ${page.id === activePage.id ? "bg-[#8a1f2d] text-white shadow-sm" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"}`} key={page.id} onClick={() => { setActivePageId(page.id); setSelectedIdeaId(null); setHoveredConnectionId(null); }} type="button"><FileText className="size-4 shrink-0" /><span className="truncate">{page.title}</span></button>)}
            </div>
            <p className="mt-4 hidden px-2 text-xs leading-5 text-zinc-500 lg:block">One board per page. Changes save automatically for every admin.</p>
          </aside>

          <div className="min-w-0 p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex items-end gap-2">
                <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-[#8a1f2d]">Idea board</p><EditablePageTitle onBlur={renamePage} title={activePage.title} /></div>
                <details className="group/page-menu relative">
                  <summary aria-label="Page options" className="idea-toolbar-button cursor-pointer list-none" title="Page options"><MoreHorizontal className="size-4" /></summary>
                  <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg">
                    <button className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50" onClick={resetPage} type="button"><RotateCcw className="size-4" /> Reset page</button>
                  </div>
                </details>
              </div>
              <div className="flex items-center gap-1.5" aria-label="Text formatting">
                <button aria-label="Bold selected text" className="idea-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("bold")} type="button"><Bold className="size-4" /></button>
                <button aria-label="Italicise selected text" className="idea-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("italic")} type="button"><Italic className="size-4" /></button>
                <button aria-label="Underline selected text" className="idea-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("underline")} type="button"><Underline className="size-4" /></button>
                <button aria-label="Create a bullet list" className="idea-toolbar-button" onMouseDown={(event) => event.preventDefault()} onClick={() => format("insertUnorderedList")} type="button"><List className="size-4" /></button>
                <span className="mx-1 h-6 border-l border-zinc-200" />
                <button className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-bold text-zinc-700 hover:bg-rose-50 hover:text-[#8a1f2d]" onClick={addFreeText} type="button"><Type className="size-4" /> Add heading</button>
                <span className="mx-1 h-6 border-l border-zinc-200" />
                <button aria-label="Zoom out" className="idea-toolbar-button" onClick={() => setZoomAround(zoom - 0.1)} title="Zoom out" type="button"><ZoomOut className="size-4" /></button>
                <button aria-label="Reset zoom to 100 percent" className="min-h-10 min-w-12 rounded-md px-2 text-center text-xs font-bold tabular-nums text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950" onClick={() => setZoomAround(1)} title="Reset zoom to 100%" type="button">{Math.round(zoom * 100)}%</button>
                <button aria-label="Zoom in" className="idea-toolbar-button" onClick={() => setZoomAround(zoom + 0.1)} title="Zoom in" type="button"><ZoomIn className="size-4" /></button>
              </div>
            </div>

            <div className="idea-board-scroll idea-canvas h-[clamp(620px,calc(100dvh-250px),820px)] overflow-auto rounded-xl border border-zinc-200 bg-[#fbfaf7]" onDoubleClick={createIdea} onPointerMove={moveCanvas} onPointerUp={finishPointer} onWheel={zoomWithWheel} ref={viewportRef} role="application" aria-label="Idea canvas. Double-click empty space to create a note.">
              <div className="relative" style={{ height: activePage.canvasHeight * zoom, width: activePage.canvasWidth * zoom }}>
              <div className="relative origin-top-left" style={{ height: activePage.canvasHeight, transform: `scale(${zoom})`, width: activePage.canvasWidth }}>
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${activePage.canvasWidth} ${activePage.canvasHeight}`}>
                  <defs><marker id="idea-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4"><path d="M0,0 L8,4 L0,8 z" fill="#8a1f2d" /></marker></defs>
                  {activePage.connections.map((connection) => {
                    const points = connectionPoints(activePage, connection);
                    if (!points) return null;
                    return <path d={curvePath(points.start, points.end)} fill="none" key={connection.id} markerEnd={connection.type === "arrow" ? "url(#idea-arrow)" : undefined} stroke="#8a1f2d" strokeDasharray={connection.type === "line" ? "8 7" : undefined} strokeWidth="2" />;
                  })}
                  {linking ? (() => { const from = activePage.ideas.find((idea) => idea.id === linking.from); return from ? <path d={curvePath({ x: from.x + 300, y: from.y + 28 }, linking)} fill="none" stroke="#8a1f2d" strokeDasharray="5 5" strokeWidth="2" /> : null; })() : null}
                </svg>
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${activePage.canvasWidth} ${activePage.canvasHeight}`}>
                  {activePage.connections.map((connection) => { const points = connectionPoints(activePage, connection); return points ? <path aria-label={`${connection.type === "arrow" ? "Arrow" : "Dashed line"} connection. Hover or focus for options.`} className="pointer-events-auto cursor-pointer" d={curvePath(points.start, points.end)} data-board-interactive data-connection-id={connection.id} fill="none" key={`hit-${connection.id}`} onClick={() => showConnectionControls(connection.id)} onFocus={() => showConnectionControls(connection.id)} onMouseEnter={() => showConnectionControls(connection.id)} onMouseLeave={() => hideConnectionControls(connection.id)} stroke="transparent" strokeWidth="18" tabIndex={0} /> : null; })}
                </svg>
                {activePage.connections.map((connection) => { const points = connectionPoints(activePage, connection); if (!points || hoveredConnectionId !== connection.id) return null; const middle = { x: (points.start.x + points.end.x) / 2, y: (points.start.y + points.end.y) / 2 }; return <div data-board-interactive key={`controls-${connection.id}`} onMouseEnter={() => showConnectionControls(connection.id)} onMouseLeave={() => hideConnectionControls(connection.id)}><button aria-label="Delete connection" className="idea-connection-action absolute z-20 text-rose-700" onClick={() => deleteConnection(connection.id)} onPointerDown={(event) => event.stopPropagation()} style={{ left: middle.x - 14, top: middle.y - 14 }} title="Delete connection" type="button"><Trash2 className="size-3.5" /></button><button aria-label={connection.type === "arrow" ? "Remove arrowhead" : "Add arrowhead"} className="idea-connection-action absolute z-20" onClick={() => toggleArrow(connection.id)} onPointerDown={(event) => event.stopPropagation()} style={{ left: points.end.x - 14, top: points.end.y - 14 }} title={connection.type === "arrow" ? "Remove arrowhead" : "Add arrowhead"} type="button"><ArrowRight className="size-3.5" /></button></div>; })}
                {activePage.ideas.map((idea) => <article className={`absolute w-[300px] rounded-xl border border-zinc-300 bg-white shadow-sm transition-shadow ${selectedIdeaId === idea.id ? "shadow-md ring-2 ring-zinc-900/10" : "hover:shadow-md"}`} data-board-interactive data-idea-id={idea.id} key={idea.id} onClick={() => setSelectedIdeaId(idea.id)} style={{ left: idea.x, top: idea.y }}>
                  <div className="idea-note-header flex min-h-12 items-center justify-between rounded-t-xl border-b border-zinc-100 bg-[#fdfcf8] px-3" onPointerDown={(event) => startCardDrag(event, idea)}>
                    <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-zinc-400"><MoreHorizontal className="size-4" /> Drag</span>
                    <div className="flex items-center gap-1">
                      <button aria-label="Drag from this port to another note to create an arrow" className="idea-connection-port" onPointerDown={(event) => startLink(event, idea)} type="button"><span /></button>
                      <button aria-label="Delete idea" className="rounded-md p-2 text-zinc-400 hover:bg-rose-50 hover:text-[#8a1f2d]" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); deleteIdea(idea.id); }} type="button"><Trash2 className="size-4" /></button>
                    </div>
                  </div>
                  <EditableHtml className="min-h-32 px-4 py-3 text-sm leading-6 text-zinc-700 outline-none [&_strong]:font-bold [&_strong]:text-zinc-950" html={idea.text} onBlur={(text) => updateText(idea.id, text)} />
                </article>)}
                {activePage.freeTexts.map((text) => <div className="group absolute flex items-center gap-1 rounded-md text-2xl font-bold text-zinc-800" data-board-interactive data-free-text-id={text.id} key={text.id} style={{ left: text.x, top: text.y }}><button aria-label="Drag heading" className="idea-heading-handle" onPointerDown={(event) => startFreeTextDrag(event, text)} title="Drag heading" type="button"><GripVertical className="size-4" /></button><EditableHtml className="min-w-24 px-1 py-1 outline-none" html={text.text} onBlur={(html) => updateFreeText(text.id, html)} /></div>)}
                {linking ? <p className="pointer-events-none absolute bottom-5 left-5 rounded-full bg-zinc-950 px-4 py-2 text-sm font-semibold text-white shadow-lg">Release over a note to connect it <ChevronDown className="ml-1 inline size-3 -rotate-90" /></p> : null}
              </div>
              </div>
            </div>
            <p className="mt-3 px-1 text-xs font-medium text-zinc-500">Double-click empty canvas to create a note. Drag note headers or heading handles to move them—the workspace expands automatically near its edges. Solid connections have arrows; dashed connections do not. Hover a connection for controls. Hold Ctrl/⌘ while scrolling to zoom around the pointer.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
