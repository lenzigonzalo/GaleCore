import React from 'react';
import { createRoot } from 'react-dom/client';
import { Lab } from '../../../../source/galecore-monitor/src/pages/Lab';
import { WorkspaceHeader } from '../../../../source/galecore-monitor/src/components/layout/WorkspaceHeader';
createRoot(document.getElementById('root')!).render(<div style={{height:'100%',display:'flex',flexDirection:'column'}}>
  <WorkspaceHeader mode="lab" active="lab" onChange={() => {}} onLogout={() => {}} conversationOpen={false} onConversation={() => {}} onSymbol={async () => {}}/>
  <div style={{flex:1,minHeight:0}}><Lab onMonitor={() => {}}/></div>
</div>);
