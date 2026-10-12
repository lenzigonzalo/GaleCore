import React from 'react';
import { createRoot } from 'react-dom/client';
import { Lab } from '../../../../source/galecore-monitor/src/pages/Lab';
createRoot(document.getElementById('root')!).render(<Lab onMonitor={() => {}}/>);
