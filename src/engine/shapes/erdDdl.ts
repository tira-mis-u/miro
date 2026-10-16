import type { TableColumnModel } from './types';

export type DdlDialect = 'postgresql' | 'mysql' | 'sqlite';

export function generateTableDdl(
  tableName: string,
  columns: readonly TableColumnModel[],
  dialect: DdlDialect = 'postgresql',
): string {
  const safeName = (tableName || 'my_table').trim().replace(/[\s-]+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') || 'my_table';
  const q = dialect === 'mysql' ? '`' : '"';

  const lines: string[] = [];
  const pkCols: string[] = [];
  const uniqueCols: string[] = [];

  for (const col of columns) {
    const rawName = col.name?.trim() || 'col';
    const cName = rawName.replace(/[\s-]+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') || 'col';
    let cType = (col.type || 'varchar(255)').trim();

    const isPk = col.key === 'primary' || col.key === 'primary_foreign';
    const isUk = col.key === 'unique';

    if (isPk) pkCols.push(cName);
    if (isUk) uniqueCols.push(cName);

    if (dialect === 'sqlite') {
      if (/bigint|integer|int|smallint|serial/i.test(cType)) {
        cType = 'INTEGER';
      } else if (/varchar|text|char|string/i.test(cType)) {
        cType = 'TEXT';
      } else if (/bool/i.test(cType)) {
        cType = 'INTEGER';
      } else if (/numeric|decimal|float|double|real/i.test(cType)) {
        cType = 'REAL';
      } else if (/timestamp|date|time/i.test(cType)) {
        cType = 'TEXT';
      } else if (/json|jsonb/i.test(cType)) {
        cType = 'TEXT';
      }
    } else if (dialect === 'mysql') {
      if (/serial/i.test(cType)) {
        cType = 'BIGINT UNSIGNED AUTO_INCREMENT';
      } else if (/timestamptz/i.test(cType)) {
        cType = 'DATETIME';
      } else if (/boolean|bool/i.test(cType)) {
        cType = 'TINYINT(1)';
      } else if (/uuid/i.test(cType)) {
        cType = 'CHAR(36)';
      } else if (/jsonb/i.test(cType)) {
        cType = 'JSON';
      }
    } else if (dialect === 'postgresql') {
      if (/serial/i.test(cType) && !cType.toLowerCase().includes('bigserial')) {
        cType = 'SERIAL';
      }
    }

    const notNull = col.nullable === false || isPk;
    const nullClause = notNull ? ' NOT NULL' : (dialect === 'sqlite' ? '' : ' NULL');

    let defaultClause = '';
    if (col.default !== undefined && col.default !== null && String(col.default).trim() !== '') {
      const defVal = String(col.default).trim();
      defaultClause = ` DEFAULT ${defVal}`;
    }

    lines.push(`  ${q}${cName}${q} ${cType}${nullClause}${defaultClause}`);
  }

  if (pkCols.length > 0) {
    const pkList = pkCols.map(c => `${q}${c}${q}`).join(', ');
    if (dialect === 'postgresql') {
      lines.push(`  CONSTRAINT ${q}pk_${safeName}${q} PRIMARY KEY (${pkList})`);
    } else {
      lines.push(`  PRIMARY KEY (${pkList})`);
    }
  }

  for (const uk of uniqueCols) {
    if (dialect === 'postgresql') {
      lines.push(`  CONSTRAINT ${q}uq_${safeName}_${uk}${q} UNIQUE (${q}${uk}${q})`);
    } else {
      lines.push(`  UNIQUE (${q}${uk}${q})`);
    }
  }

  return `CREATE TABLE ${q}${safeName}${q} (\n${lines.join(',\n')}\n);`;
}
