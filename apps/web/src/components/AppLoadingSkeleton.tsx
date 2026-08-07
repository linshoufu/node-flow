type AppLoadingSkeletonProps = {
  variant: "canvas" | "node-library";
};

/**
 * 初始加载骨架屏：在节点目录首次加载完成前，
 * 为画布与节点库分区提供纯 CSS 骨架占位，替代原先的加载 toast。
 */
export function AppLoadingSkeleton({ variant }: AppLoadingSkeletonProps) {
  if (variant === "node-library") {
    return (
      <div aria-label="节点库加载中" className="app-skeleton app-skeleton-node-library" role="status">
        <div className="app-skeleton-bar app-skeleton-heading" />
        <div className="app-skeleton-card">
          <div className="app-skeleton-bar app-skeleton-line-long" />
          <div className="app-skeleton-bar app-skeleton-line-short" />
        </div>
        <div className="app-skeleton-card">
          <div className="app-skeleton-bar app-skeleton-line-long" />
          <div className="app-skeleton-bar app-skeleton-line-short" />
        </div>
        <div className="app-skeleton-card">
          <div className="app-skeleton-bar app-skeleton-line-long" />
          <div className="app-skeleton-bar app-skeleton-line-short" />
        </div>
        <div className="app-skeleton-card">
          <div className="app-skeleton-bar app-skeleton-line-long" />
          <div className="app-skeleton-bar app-skeleton-line-short" />
        </div>
      </div>
    );
  }

  return (
    <div aria-label="画布加载中" className="app-skeleton app-skeleton-canvas" role="status">
      <div className="app-skeleton-node app-skeleton-node-a">
        <div className="app-skeleton-bar app-skeleton-line-long" />
        <div className="app-skeleton-bar app-skeleton-line-short" />
      </div>
      <div className="app-skeleton-edge" />
      <div className="app-skeleton-node app-skeleton-node-b">
        <div className="app-skeleton-bar app-skeleton-line-long" />
        <div className="app-skeleton-bar app-skeleton-line-short" />
      </div>
    </div>
  );
}
