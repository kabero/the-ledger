import Markdown from "react-markdown";
import { remarkPlugins, safeUrlTransform } from "../markdown";

interface SourcedEntry {
  id: string;
  title: string | null;
  raw_text: string;
  source: string | null;
  result: string | null;
  result_url?: string | null;
}

interface SourcedListProps {
  summaries: SourcedEntry[];
  sourced: SourcedEntry[];
  /** "sidebar" uses sidebar-title; "modal" uses sourced-modal-section-title */
  variant: "sidebar" | "modal";
}

function truncateWithEllipsis(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function SourcedList({ summaries, sourced, variant }: SourcedListProps) {
  const sectionTitleClass = variant === "sidebar" ? "sidebar-title" : "sourced-modal-section-title";

  const renderCard = (entry: SourcedEntry, isSummary: boolean) => (
    <div key={entry.id} className={`sidebar-card${isSummary ? " sidebar-card-summary-type" : ""}`}>
      <div className="sidebar-card-header">
        {entry.source && <span className="ai-badge source">{entry.source}</span>}
        <span className="sidebar-card-title">{entry.title ?? entry.raw_text}</span>
      </div>
      {entry.result && (
        <div className="sidebar-card-summary">
          <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
            {truncateWithEllipsis(entry.result, 200).replace(/\\n/g, "\n")}
          </Markdown>
        </div>
      )}
      {isSummary && !entry.result && entry.raw_text && (
        <div className="sidebar-card-summary">
          <Markdown remarkPlugins={remarkPlugins} urlTransform={safeUrlTransform}>
            {truncateWithEllipsis(entry.raw_text, 300).replace(/\\n/g, "\n")}
          </Markdown>
        </div>
      )}
      {!isSummary &&
        entry.result_url &&
        (variant === "sidebar" ? (
          <a
            href={entry.result_url}
            target="_blank"
            rel="noopener noreferrer"
            className="entry-result-url"
          >
            {"\u2197"} URL
          </a>
        ) : (
          <button
            type="button"
            className="entry-result-url-btn"
            onClick={() =>
              window.open(entry.result_url as string, "_blank", "noopener,noreferrer,popup")
            }
          >
            {"\u2197"} URL
          </button>
        ))}
    </div>
  );

  return (
    <>
      {summaries.length > 0 && (
        <>
          <div className={sectionTitleClass}>サマリ</div>
          {summaries.map((e) => renderCard(e, true))}
        </>
      )}
      {sourced.length > 0 && (
        <>
          <div className={sectionTitleClass}>外部入力</div>
          {sourced.map((e) => renderCard(e, false))}
        </>
      )}
    </>
  );
}
