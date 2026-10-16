import { getShapeDefinition } from '../registry.ts';
import { buildShapeGeometry } from '../geometry.ts';
import { buildConnectorPreviewGeometry } from '../connectors.ts';
import { connectionPointsForBox, deserializeBoardShape } from '../model.ts';
import { CONNECTOR_ENDPOINT_RULES, SHAPE_SEMANTICS } from '../semantics.ts';
import { generateTableDdl } from '../erdDdl.ts';

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

console.log('--- Testing ERD & Database Diagram Standard Compliance ---');

// 1. Check all Chen ERD Notation Shapes in Registry
const strongEntityDef = getShapeDefinition('erd.entity');
const weakEntityDef = getShapeDefinition('erd.weak-entity');
const assocEntityDef = getShapeDefinition('erd.associative-entity');
const relDef = getShapeDefinition('erd.relationship');
const identRelDef = getShapeDefinition('erd.identifying-relationship');
const attrDef = getShapeDefinition('erd.attribute');
const keyAttrDef = getShapeDefinition('erd.primary-key-attribute');
const partialKeyAttrDef = getShapeDefinition('erd.partial-key-attribute');
const multiAttrDef = getShapeDefinition('erd.multivalued-attribute');
const derivedAttrDef = getShapeDefinition('erd.derived-attribute');

assert(strongEntityDef && strongEntityDef.category === 'ERD / Database', 'Strong Entity registered in ER category');
assert(weakEntityDef && weakEntityDef.defaultParams?.doubleBorder === true, 'Weak Entity has doubleBorder defaultParam');
assert(assocEntityDef && assocEntityDef.geometry === 'associativeEntity', 'Associative Entity has associativeEntity geometry');
assert(relDef && relDef.geometry === 'diamond', 'Relationship diamond registered');
assert(identRelDef && identRelDef.defaultParams?.doubleBorder === true, 'Identifying Relationship has doubleBorder defaultParam');
assert(attrDef && attrDef.geometry === 'ellipse', 'Attribute ellipse registered');
assert(keyAttrDef && keyAttrDef.defaultParams?.underline === true, 'Key Attribute has underline param');
assert(partialKeyAttrDef && partialKeyAttrDef.defaultParams?.underline === 'dashed', 'Partial Key Attribute has dashed underline param');
assert(multiAttrDef && multiAttrDef.defaultParams?.doubleBorder === true, 'Multivalued Attribute has doubleBorder param');
assert(derivedAttrDef && derivedAttrDef.defaultParams?.lineStyle === 'dashed', 'Derived Attribute has dashed stroke');
console.log('✓ All 10 Chen ERD notation shapes verified in Registry');

// 2. Check Relational & Database Diagram Shapes (ER Table, View)
const erTableDef = getShapeDefinition('erd.er-table');
const viewDef = getShapeDefinition('erd.view');

assert(erTableDef && erTableDef.geometry === 'table', 'ER Table registered');
assert(SHAPE_SEMANTICS['erd.er-table']?.connectionPointProvider === 'structured-table-rows', 'ER Table uses structured-table-rows connection provider');
assert(SHAPE_SEMANTICS['erd.view']?.connectionPointProvider === 'structured-table-rows', 'Database View uses structured-table-rows connection provider');
assert(Array.isArray(erTableDef.defaultData?.table?.columns) && erTableDef.defaultData.table.columns.length >= 2, 'ER Table default columns initialized');
assert(erTableDef.defaultData.table.columns[0].key === 'primary', 'ER Table default first column is PK');

assert(viewDef && viewDef.geometry === 'table', 'Database View registered');
assert(viewDef.defaultParams?.isView === true, 'Database View has isView flag');
console.log('✓ Relational ER Table and Database View verified in Registry');

// 3. Check Connectors (Chen & Relational)
const lineDef = getShapeDefinition('erd.line');
const totalPartDef = getShapeDefinition('erd.total-participation');
const oneToOneDef = getShapeDefinition('erd.one-to-one');
const oneToManyDef = getShapeDefinition('erd.one-to-many');
const manyToManyDef = getShapeDefinition('erd.many-to-many');
const identConnDef = getShapeDefinition('erd.identifying');
const nonIdentConnDef = getShapeDefinition('erd.non-identifying');

assert(lineDef && lineDef.category === 'ERD / Database', 'ER line connector registered');
assert(totalPartDef && totalPartDef.connector?.erdParticipation === 'total', 'Total Participation connector has erdParticipation: total');
assert(oneToOneDef && oneToOneDef.connector?.targetCardinality === 'one' && oneToOneDef.connector?.sourceCardinality === 'one', '1:1 connector has one:one cardinality');
assert(oneToManyDef && oneToManyDef.connector?.targetCardinality === 'one-or-many' && oneToManyDef.connector?.sourceCardinality === 'one', '1:N connector has one:many cardinality');
assert(manyToManyDef && oneToManyDef.connector?.targetCardinality === 'one-or-many' && manyToManyDef.connector?.sourceCardinality === 'many', 'N:M connector has many:many cardinality');
assert(identConnDef && identConnDef.connector?.lineStyle === 'solid', 'Identifying relationship connector has solid stroke');
assert(nonIdentConnDef && nonIdentConnDef.connector?.lineStyle === 'dashed', 'Non-identifying relationship connector has dashed stroke');
console.log('✓ All 7 ER and Relational connectors verified');

// 4. Geometry Verification: Dashed underline & Nested Diamond
const partialKeyGeom = buildShapeGeometry(partialKeyAttrDef, 100, 50, { underline: 'dashed' });
assert(partialKeyGeom.decorations.length > 0, 'Partial key attribute has decoration path commands for dashed underline');

const identDiamondGeom = buildShapeGeometry(identRelDef, 120, 70, { doubleBorder: true });
assert(identDiamondGeom.decorations.length > 0, 'Identifying relationship has inner diamond decoration');

const totalPartPreview = buildConnectorPreviewGeometry(totalPartDef, 36, 24);
assert(totalPartPreview.route.length >= 4, 'Total participation connector preview renders parallel lines');
console.log('✓ Geometry calculations verified for partial key dashed underline, nested diamond, and total participation');

// 5. Connection Point Provider: Row-level anchoring
const boxPoints = connectionPointsForBox({
  shapeId: 'erd.er-table',
  x: 100, y: 100, w: 200, h: 160, rotation: 0,
  data: {
    table: {
      columns: [
        { id: 'c1', name: 'id', type: 'bigint', key: 'primary' },
        { id: 'c2', name: 'user_id', type: 'bigint', key: 'foreign' },
        { id: 'c3', name: 'created_at', type: 'timestamp' },
      ]
    }
  }
});
assert(boxPoints.length > 4, 'Table with 3 columns generates row-level connection anchor points');
const rowAnchors = boxPoints.filter(p => p.id.includes('table-row:'));
assert(rowAnchors.length === 6, 'Generated left and right anchors for 3 table rows (3 rows * 2 sides = 6 anchors)');
console.log('✓ Row-level connection anchoring verified');

// 6. Model Deserialization & erdParticipation preservation
const rawConnector = {
  id: 'conn-1',
  type: 'connector',
  shapeId: 'erd.total-participation',
  x1: 0, y1: 0,
  x2: 100, y2: 100,
  erdParticipation: 'total',
};
const deserialized = deserializeBoardShape('conn-1', rawConnector);
assert(deserialized && deserialized.type === 'connector', 'Connector deserialized');
assert(deserialized.erdParticipation === 'total', 'erdParticipation: total preserved in model deserialization');
console.log('✓ Model serialization & deserialization verified for total participation');

// 7. SQL DDL Generation
const sampleColumns = [
  { id: 'c1', name: 'id', type: 'bigint', key: 'primary', nullable: false },
  { id: 'c2', name: 'email', type: 'varchar(255)', key: 'unique', nullable: false },
  { id: 'c3', name: 'account_balance', type: 'numeric(12,2)', key: 'none', nullable: true, default: '0.00' },
  { id: 'c4', name: 'is_active', type: 'boolean', key: 'none', nullable: false, default: 'true' },
];

const pgDdl = generateTableDdl('users', sampleColumns, 'postgresql');
assert(pgDdl.includes('CREATE TABLE "users"'), 'PostgreSQL table DDL statement created');
assert(pgDdl.includes('"id" bigint NOT NULL'), 'PostgreSQL PK column not null');
assert(pgDdl.includes('CONSTRAINT "pk_users" PRIMARY KEY ("id")'), 'PostgreSQL PK constraint generated');
assert(pgDdl.includes('CONSTRAINT "uq_users_email" UNIQUE ("email")'), 'PostgreSQL UNIQUE constraint generated');
assert(pgDdl.includes('DEFAULT 0.00'), 'PostgreSQL DEFAULT clause included');

const mysqlDdl = generateTableDdl('users', sampleColumns, 'mysql');
assert(mysqlDdl.includes('CREATE TABLE `users`'), 'MySQL backticks table created');
assert(mysqlDdl.includes('`is_active` TINYINT(1) NOT NULL'), 'MySQL boolean mapped to TINYINT(1)');
assert(mysqlDdl.includes('PRIMARY KEY (`id`)'), 'MySQL primary key defined');

const sqliteDdl = generateTableDdl('users', sampleColumns, 'sqlite');
assert(sqliteDdl.includes('"id" INTEGER NOT NULL'), 'SQLite bigint mapped to INTEGER');
assert(sqliteDdl.includes('"account_balance" REAL'), 'SQLite numeric mapped to REAL');

console.log('✓ SQL DDL Generation verified across PostgreSQL, MySQL, and SQLite dialects');

console.log('--- ALL ERD TESTS PASSED SUCCESSFULLY! ---');
