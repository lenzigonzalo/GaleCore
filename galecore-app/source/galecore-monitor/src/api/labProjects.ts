import type { WorkspaceProject } from './lab';

// Estrategias de un proyecto (WS-0071): la lista que declara el Lab. Un proyecto sin estrategias devuelve [].
export const strategiesOf = (p?: Pick<WorkspaceProject, 'strategies'> | null): string[] => p?.strategies ?? [];
