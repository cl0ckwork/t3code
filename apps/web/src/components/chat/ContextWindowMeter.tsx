import { Button } from "../ui/button";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { formatContextWindowCompactionMessage } from "./ContextWindowMeter.logic";
import { Minimize2Icon } from "lucide-react";
import { composerFloatingLayerProps } from "./composerEventScope";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  modelDisplayName?: string | null;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}) {
  const { usage, modelDisplayName, onCompact, compactDisabled, compactDisabledReason } = props;
  const hasLiveContextUsage = usage.contextUsageAvailable;
  const maxTokens = usage.maxTokens ?? null;
  const estimatedContextTokens = usage.lastUsedTokens ?? usage.usedTokens;
  const estimatedPercentage =
    !hasLiveContextUsage && maxTokens !== null && maxTokens > 0
      ? Math.min(100, (estimatedContextTokens / maxTokens) * 100)
      : null;
  const contextTokens = hasLiveContextUsage ? usage.usedTokens : estimatedContextTokens;
  const contextPercentage = hasLiveContextUsage ? usage.usedPercentage : estimatedPercentage;
  const usedPercentage = formatPercentage(contextPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, contextPercentage ?? 0));
  const hasContextEstimate = !hasLiveContextUsage && estimatedPercentage !== null;
  const canShowContextMeter = hasLiveContextUsage || hasContextEstimate;
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedPercentage / 100);
  const isOverloaded = normalizedPercentage > 90;
  const usageColor = isOverloaded
    ? "var(--color-error)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={onCompact ? 150 : 0}
        render={
          <Button
            size={hasLiveContextUsage ? "icon-sm" : "compact"}
            variant="ghost-muted"
            aria-label={
              hasContextEstimate && maxTokens !== null && usedPercentage
                ? `Estimated context from the last request: ${usedPercentage} used`
                : hasLiveContextUsage && maxTokens !== null && usedPercentage
                  ? `Context window ${usedPercentage} used`
                  : `Context window ${formatContextWindowTokens(contextTokens)} tokens used`
            }
          >
            {canShowContextMeter ? (
              <>
                <span className="relative flex size-5 items-center justify-center">
                  <svg
                    viewBox="0 0 24 24"
                    className="-rotate-90 absolute inset-0 size-full transform-gpu mx-0!"
                    aria-hidden="true"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r={radius}
                      fill="none"
                      className="stroke-muted-foreground/24"
                      strokeWidth="3"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r={radius}
                      fill="none"
                      stroke={usageColor}
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                    />
                  </svg>
                </span>
                {hasContextEstimate && usedPercentage ? (
                  <span className="tabular-nums">{usedPercentage}</span>
                ) : null}
              </>
            ) : null}
          </Button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        padding="none"
        width="sm"
        className="text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2 p-(--floating-content-inset)">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">
              {hasLiveContextUsage ? "Context window" : "Last request context"}
            </div>
            {maxTokens !== null && usedPercentage ? (
              <div className="text-secondary-label text-2xs tabular-nums">
                {hasContextEstimate ? <span>Estimate · </span> : null}
                <span>{usedPercentage}</span>
                <span className="mx-1">·</span>
                <span>
                  {formatContextWindowTokens(contextTokens)}/{formatContextWindowTokens(maxTokens)}
                </span>
              </div>
            ) : (
              <div className="text-secondary-label text-2xs tabular-nums">
                {formatContextWindowTokens(contextTokens)}
              </div>
            )}
          </div>
          {canShowContextMeter && maxTokens !== null ? (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(normalizedPercentage)}
              aria-label={hasContextEstimate ? "Estimated context usage" : "Context window usage"}
            >
              <div
                className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${normalizedPercentage}%`, backgroundColor: usageColor }}
              />
            </div>
          ) : null}
          {hasContextEstimate ? (
            <div className="text-pretty text-secondary-label text-2xs">
              Estimated from the most recent model request. Codex does not report live context after
              automatic compaction.
            </div>
          ) : null}
          {!hasLiveContextUsage && !hasContextEstimate && maxTokens !== null ? (
            <div className="text-pretty text-secondary-label text-2xs">
              Codex reports a {formatContextWindowTokens(maxTokens)} context window · live fill
              unavailable
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="mt-1 text-pretty text-secondary-label text-2xs font-medium">
              {formatContextWindowCompactionMessage(modelDisplayName, usage.autoCompactThreshold)}
            </div>
          ) : null}
          {onCompact ? (
            <>
              <Button
                size="xs"
                variant="outline"
                className="mt-1 w-full justify-center"
                disabled={compactDisabled}
                onClick={onCompact}
              >
                <Minimize2Icon aria-hidden="true" />
                Compact context
              </Button>
              {compactDisabled && compactDisabledReason ? (
                <div className="text-pretty text-secondary-label text-2xs">
                  {compactDisabledReason}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Holds the meter's footprint while a thread's activities are still loading. */
export function ContextWindowMeterPlaceholder() {
  return <span aria-hidden="true" className="size-12 shrink-0" />;
}
