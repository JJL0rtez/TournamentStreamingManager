import { Component, type ReactNode, type ErrorInfo } from 'react';

/** Keep a browser rendering failure distinguishable from a stopped Node service. */
export class DashboardErrorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(error:Error,info:ErrorInfo){console.error('Tournament dashboard render failed:',error,info.componentStack);}
  render(){return this.state.failed?<main className="dashboard-render-error" role="alert"><h1>Dashboard failed to render</h1><p>Reload the interface to reconnect. Reloading does not stop camera recordings or streams on the Node service.</p><button type="button" onClick={()=>window.location.reload()}>Reload dashboard</button><p>For diagnosis, open the browser developer console (F12) and copy the first error and its stack trace.</p></main>:this.props.children;}
}
