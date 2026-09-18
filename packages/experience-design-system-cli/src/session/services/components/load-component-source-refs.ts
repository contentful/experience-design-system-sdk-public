import type { DatabaseSync } from 'node:sqlite';
import type { ComponentSourceRef } from '@contentful/experience-design-system-generation';
import { loadComponentSourceRef } from '../../../adapters/component-source/load-source-ref.js';
import { getGeneratedComponentSources } from '../../repositories/components/raw/read.js';

export async function loadComponentSourceRefs(db: DatabaseSync, sessionId: string): Promise<ComponentSourceRef[]> {
  const rows = getGeneratedComponentSources(db, sessionId);
  return Promise.all(
    rows.map((r) =>
      loadComponentSourceRef(
        r.name,
        r.source_path ?? r.source,
        r.props.map((p) => p.name),
        r.props.map((p) => p.type),
      ),
    ),
  );
}
