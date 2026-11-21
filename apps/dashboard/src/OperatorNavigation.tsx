import { operatorError } from "./operator-errors";

export type OperatorView = "live" | "setup" | "settings" | "maintenance";
const views: Array<{id: OperatorView; label: string}> = [
  {id: "live", label:"Live Operations"}, {id:"setup", label:"Tournament Setup"},
  {id:"settings", label:"Settings"}, {id:"maintenance", label:"Maintenance"}
];
export function OperatorNavigation({ view, onChange, nodeName }: {view: OperatorView; onChange: (value: OperatorView) => void; nodeName: string}) {
  return <nav className="operator-navigation" aria-label={`${nodeName} workspaces`}>
    {views.map(item => <button type="button" key={item.id} aria-pressed={view===item.id}
      className={view===item.id ? "operator-navigation-active" : ""} onClick={()=>onChange(item.id)}>{item.label}</button>)}
  </nav>;
}
export function OperatorErrorNotice({ message, onDismiss }: {message: string; onDismiss?: () => void}) {
  const {summary, detail} = operatorError(message);
  return <div className="alert operator-error-notice" role="alert"><div className="operator-error-heading"><strong>{summary}</strong>
    {onDismiss && <button type="button" onClick={onDismiss}>Dismiss</button>}</div>
    {detail!==summary && <details><summary>Technical details</summary><p className="operator-error-detail">{detail}</p></details>}</div>;
}
