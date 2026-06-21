/** 未实现功能的占位页:显式标注假数据,功能待实现。 */

export function Placeholder(props: { title: string; note: string }) {
  return (
    <div className="placeholder" data-testid="placeholder">
      <div>
        <div className="big">{props.title}</div>
        <div className="fake">{props.note} (placeholder — coming soon)</div>
      </div>
    </div>
  );
}
