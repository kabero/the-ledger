import { useCallback, useEffect, useRef, useState } from "react";
// @ts-expect-error no type definitions for react-force-graph-2d
import ForceGraph2D from "react-force-graph-2d";
import { POLL } from "../poll";
import { trpc } from "../trpc";

const TYPE_COLORS: Record<string, string> = {
  task: "#ff0",
  note: "#fff",
  wish: "#0f0",
};

interface GraphNode {
  id: string;
  label: string;
  type: string;
  color: string;
}

interface GraphLink {
  source: string;
  target: string;
  value: number;
}

interface GraphViewProps {
  fullscreen?: boolean;
}

export function GraphView({ fullscreen }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 400 });

  const entries = trpc.listEntries.useQuery({ processed: true }, { refetchInterval: POLL.entries });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      if (fullscreen) {
        setSize({ width: window.innerWidth, height: window.innerHeight });
      } else {
        setSize({ width: el.clientWidth, height: Math.max(400, el.clientWidth * 0.8) });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [fullscreen]);

  const items = (entries.data ?? []).filter((e) => e.type !== "trash" && e.status !== "done");

  // Build graph data
  const nodes: GraphNode[] = items.map((e) => ({
    id: e.id,
    label: (e.title ?? e.raw_text ?? "").slice(0, 20),
    type: e.type ?? "note",
    color: TYPE_COLORS[e.type ?? "note"] ?? "#fff",
  }));

  // Tag frequency map and tag -> entry ids index (single pass)
  const tagCount: Record<string, number> = {};
  const tagEntries: Record<string, string[]> = {};
  for (const e of items) {
    for (const tag of e.tags ?? []) {
      tagCount[tag] = (tagCount[tag] ?? 0) + 1;
      if (!tagEntries[tag]) tagEntries[tag] = [];
      tagEntries[tag].push(e.id);
    }
  }

  // Build edges from shared tags
  const linkMap = new Map<string, number>();
  for (const [tag, ids] of Object.entries(tagEntries)) {
    const rarity = 1 / (tagCount[tag] ?? 1);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join("--");
        linkMap.set(key, (linkMap.get(key) ?? 0) + rarity);
      }
    }
  }

  const links: GraphLink[] = [];
  for (const [key, value] of linkMap) {
    const [source, target] = key.split("--");
    links.push({ source, target, value });
  }

  const graphData = { nodes, links };
  const nodeSize = fullscreen ? 4 : 3;
  const fontSize = fullscreen ? 4 : 3;

  // biome-ignore lint/suspicious/noExplicitAny: untyped library
  const fgRef = useRef<any>(null);
  const onEngineStop = useCallback(() => {
    fgRef.current?.zoomToFit(300, 60);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: fullscreen ? "100vh" : undefined,
        minHeight: fullscreen ? undefined : 400,
      }}
    >
      {nodes.length === 0 ? (
        <div className="unprocessed-text">グラフに表示するエントリがありません。</div>
      ) : (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          nodeCanvasObject={(
            node: GraphNode & { x: number; y: number },
            ctx: CanvasRenderingContext2D,
          ) => {
            ctx.beginPath();
            ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();

            const fontFamily =
              getComputedStyle(document.documentElement).getPropertyValue("--font").trim() ||
              "'DotGothic16', monospace";
            ctx.font = `${fontSize}px ${fontFamily}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.fillText(node.label, node.x, node.y + nodeSize + 1);
          }}
          nodePointerAreaPaint={(
            node: GraphNode & { x: number; y: number },
            color: string,
            ctx: CanvasRenderingContext2D,
          ) => {
            ctx.beginPath();
            ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
          linkColor={() => "rgba(255,255,255,0.15)"}
          linkWidth={(link: GraphLink) => Math.min(link.value * 2, 4)}
          cooldownTicks={100}
          onEngineStop={onEngineStop}
          enableZoomInteraction={true}
          enablePanInteraction={true}
        />
      )}
    </div>
  );
}
