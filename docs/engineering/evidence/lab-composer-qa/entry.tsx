import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Lab } from '../../../../source/galecore-monitor/src/pages/Lab';
import { WorkspaceHeader } from '../../../../source/galecore-monitor/src/components/layout/WorkspaceHeader';
import { LiveWatchlist } from '../../../../source/galecore-monitor/src/components/ticker/LiveWatchlist';
import type { WorkspaceMode } from '../../../../source/galecore-monitor/src/components/layout/WorkspaceNav';
function Preview() {
  const [mode,setMode]=useState<WorkspaceMode>('lab');
  return <div className="workspace-shell has-watchlist-dock" style={{height:'100%',display:'flex',flexDirection:'column'}}>
    <WorkspaceHeader mode={mode} onModeChange={setMode} active="lab" onChange={() => {}} onLogout={() => {}} conversationOpen={false} onConversation={() => {}} onSymbol={async () => {}}/>
    <div style={{flex:1,minHeight:0}}><Lab onMonitor={() => {}}/></div>
    <LiveWatchlist open={false} enabled onClose={()=>{}} onOpenSettings={()=>{}} onLogout={()=>{}} onSelect={()=>{}} socketStatus="disconnected" subscribeSymbol={()=>{}} unsubscribeSymbol={()=>{}}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
