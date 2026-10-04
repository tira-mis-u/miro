import type { ConnectorRuleId, EndpointSide, ShapeDefinition, ShapeSemanticMetadata } from './types';

/**
 * Reviewed semantic role catalogue for the UML/BPMN/ERD entries currently in the library.
 * It is definition metadata only: rendering and interaction consume families/groups, never
 * notation-specific pixel or object-id branches.
 */
export const SHAPE_SEMANTICS: Readonly<Record<string, ShapeSemanticMetadata>> = {
  'flow.process': { notation: 'flow', family: 'flow.node', role: 'process step', connectionGroups: ['flowchart.node'] },
  'flow.decision': { notation: 'flow', family: 'flow.branch', role: 'decision or branch', connectionGroups: ['flowchart.node'] },
  'flow.terminator': { notation: 'flow', family: 'flow.terminator', role: 'start or end', connectionGroups: ['flowchart.node'] },
  'flow.input-output': { notation: 'flow', family: 'flow.data-node', role: 'input or output', connectionGroups: ['flowchart.node'] },
  'flow.predefined-process': { notation: 'flow', family: 'flow.process', role: 'predefined process or subroutine', connectionGroups: ['flowchart.node'] },
  'flow.document': { notation: 'flow', family: 'flow.document', role: 'document', connectionGroups: ['flowchart.node', 'flowchart.artifact'] },
  'flow.multiple-documents': { notation: 'flow', family: 'flow.document-stack', role: 'multiple documents', connectionGroups: ['flowchart.node', 'flowchart.artifact'] },
  'flow.database': { notation: 'flow', family: 'flow.storage', role: 'stored data', connectionGroups: ['flowchart.node', 'flowchart.artifact'] },
  'flow.internal-storage': { notation: 'flow', family: 'flow.storage', role: 'internal storage', connectionGroups: ['flowchart.node', 'flowchart.artifact'] },
  'flow.manual-input': { notation: 'flow', family: 'flow.input', role: 'manual input', connectionGroups: ['flowchart.node'] },
  'flow.manual-operation': { notation: 'flow', family: 'flow.operation', role: 'manual operation', connectionGroups: ['flowchart.node'] },
  'flow.preparation': { notation: 'flow', family: 'flow.operation', role: 'preparation', connectionGroups: ['flowchart.node'] },
  'flow.display': { notation: 'flow', family: 'flow.output', role: 'display', connectionGroups: ['flowchart.node'] },
  'flow.delay': { notation: 'flow', family: 'flow.control', role: 'delay', connectionGroups: ['flowchart.node'] },
  'flow.connector': { notation: 'flow', family: 'flow.on-page-connector', role: 'on-page connector', connectionGroups: ['flowchart.node'] },
  'flow.off-page-connector': { notation: 'flow', family: 'flow.off-page-connector', role: 'off-page connector', connectionGroups: ['flowchart.node'] },
  'flow.data': { notation: 'flow', family: 'flow.data-node', role: 'retained input/output alias', connectionGroups: ['flowchart.node'] },
  'flow.direct-access-storage': { notation: 'flow', family: 'flow.storage', role: 'direct-access storage', connectionGroups: ['flowchart.node', 'flowchart.artifact'] },
  'flow.magnetic-disk': { notation: 'flow', family: 'flow.storage', role: 'magnetic disk storage', connectionGroups: ['flowchart.node', 'flowchart.artifact'] },
  'flow.magnetic-tape': { notation: 'flow', family: 'flow.storage', role: 'magnetic tape storage', connectionGroups: ['flowchart.node', 'flowchart.artifact'] },
  'flow.summing-junction': { notation: 'flow', family: 'flow.junction', role: 'summing junction', connectionGroups: ['flowchart.node'] },
  'flow.collate': { notation: 'flow', family: 'flow.operation', role: 'collation', connectionGroups: ['flowchart.node'] },
  'flow.sort': { notation: 'flow', family: 'flow.operation', role: 'sort', connectionGroups: ['flowchart.node'] },
  'flow.extract': { notation: 'flow', family: 'flow.operation', role: 'extract', connectionGroups: ['flowchart.node'] },
  'flow.merge': { notation: 'flow', family: 'flow.operation', role: 'merge', connectionGroups: ['flowchart.node'] },
  'basic.actor': { notation: 'uml', family: 'uml.actor', role: 'retained actor identity', connectionGroups: ['uml.usecase.actor'] },
  'uml.actor': { notation: 'uml', family: 'uml.actor', role: 'use-case actor', connectionGroups: ['uml.usecase.actor'] },
  'uml.use-case': { notation: 'uml', family: 'uml.use-case', role: 'use case', connectionGroups: ['uml.usecase.use-case'] },
  'uml.system-boundary': { notation: 'uml', family: 'uml.use-case.container', role: 'system boundary', container: { accepts: ['uml.usecase.use-case'] } },
  'uml.package': { notation: 'uml', family: 'uml.package', role: 'package', connectionGroups: ['uml.package'], container: { accepts: ['uml.classifier', 'uml.package', 'uml.component'] } },
  'uml.module': { notation: 'uml', family: 'uml.package', role: 'module', connectionGroups: ['uml.package'], container: { accepts: ['uml.classifier', 'uml.package', 'uml.component'] } },
  'uml.note': { notation: 'uml', family: 'uml.annotation', role: 'note' },
  'uml.class': { notation: 'uml', family: 'uml.classifier', role: 'class', connectionGroups: ['uml.classifier'] },
  'uml.abstract-class': { notation: 'uml', family: 'uml.classifier', role: 'abstract class', connectionGroups: ['uml.classifier'] },
  'uml.interface': { notation: 'uml', family: 'uml.classifier', role: 'interface', connectionGroups: ['uml.classifier', 'uml.interface'] },
  'uml.enumeration': { notation: 'uml', family: 'uml.classifier', role: 'enumeration', connectionGroups: ['uml.classifier'] },
  'uml.object': { notation: 'uml', family: 'uml.instance', role: 'object instance', connectionGroups: ['uml.instance'] },
  'uml.component': { notation: 'uml', family: 'uml.component', role: 'component', connectionGroups: ['uml.classifier', 'uml.component'] },
  'uml.provided-interface': { notation: 'uml', family: 'uml.interface-end', role: 'provided interface', connectionGroups: ['uml.interface.provided'] },
  'uml.required-interface': { notation: 'uml', family: 'uml.interface-end', role: 'required interface', connectionGroups: ['uml.interface.required'] },
  'uml.lifeline': { notation: 'uml', family: 'uml.sequence-participant', role: 'lifeline', connectionGroups: ['uml.sequence.participant', 'uml.sequence.lifeline'] },
  'uml.sequence-actor': { notation: 'uml', family: 'uml.sequence-participant', role: 'actor participant', connectionGroups: ['uml.sequence.participant', 'uml.sequence.lifeline'] },
  'uml.activation': { notation: 'uml', family: 'uml.sequence-control', role: 'activation bar' },
  'uml.boundary': { notation: 'uml', family: 'uml.sequence-participant', role: 'boundary object', connectionGroups: ['uml.sequence.participant'] },
  'uml.control': { notation: 'uml', family: 'uml.sequence-participant', role: 'control object', connectionGroups: ['uml.sequence.participant'] },
  'uml.entity': { notation: 'uml', family: 'uml.sequence-participant', role: 'entity object', connectionGroups: ['uml.sequence.participant'] },
  'uml.destroy': { notation: 'uml', family: 'uml.sequence-control', role: 'destruction mark' },
  'uml.frame': { notation: 'uml', family: 'uml.sequence-frame', role: 'sequence frame', container: { accepts: ['uml.sequence.participant'] } },
  'uml.state': { notation: 'uml', family: 'uml.state-vertex', role: 'state', connectionGroups: ['uml.state.vertex'] },
  'uml.composite-state': { notation: 'uml', family: 'uml.state-container', role: 'composite state', connectionGroups: ['uml.state.vertex'], container: { accepts: ['uml.state.vertex'] } },
  'uml.initial-state': { notation: 'uml', family: 'uml.pseudostate', role: 'initial state / activity node', connectionGroups: ['uml.state.vertex', 'uml.activity.node'] },
  'uml.final-state': { notation: 'uml', family: 'uml.pseudostate', role: 'final state / activity node', connectionGroups: ['uml.state.vertex', 'uml.activity.node'] },
  'uml.choice-junction': { notation: 'uml', family: 'uml.pseudostate', role: 'choice or junction', connectionGroups: ['uml.state.vertex'] },
  'uml.shallow-history': { notation: 'uml', family: 'uml.pseudostate', role: 'shallow history', connectionGroups: ['uml.state.vertex'] },
  'uml.deep-history': { notation: 'uml', family: 'uml.pseudostate', role: 'deep history', connectionGroups: ['uml.state.vertex'] },
  'uml.entry-point': { notation: 'uml', family: 'uml.pseudostate', role: 'entry point', connectionGroups: ['uml.state.vertex'] },
  'uml.exit-point': { notation: 'uml', family: 'uml.pseudostate', role: 'exit point', connectionGroups: ['uml.state.vertex'] },
  'uml.fork': { notation: 'uml', family: 'uml.fork-join', role: 'activity/state fork or join', connectionGroups: ['uml.state.vertex', 'uml.activity.node'] },
  'uml.decision': { notation: 'uml', family: 'uml.activity-node', role: 'decision or merge', connectionGroups: ['uml.activity.node'] },
  'uml.activity': { notation: 'uml', family: 'uml.activity-frame', role: 'activity frame', container: { accepts: ['uml.activity.node'] } },
  'uml.action': { notation: 'uml', family: 'uml.activity-node', role: 'action', connectionGroups: ['uml.activity.node'] },
  'uml.object-node': { notation: 'uml', family: 'uml.activity-node', role: 'object node', connectionGroups: ['uml.activity.node'] },
  'uml.activity-partition': { notation: 'uml', family: 'uml.activity-container', role: 'activity partition', container: { accepts: ['uml.activity.node'] } },
  'uml-association': { notation: 'uml', family: 'uml.relationship-edge', role: 'association' },
  'uml-directed-association': { notation: 'uml', family: 'uml.relationship-edge', role: 'navigable association' },
  'uml.include': { notation: 'uml', family: 'uml.usecase-dependency', role: 'include dependency' },
  'uml.extend': { notation: 'uml', family: 'uml.usecase-dependency', role: 'extend dependency' },
  'uml-aggregation': { notation: 'uml', family: 'uml.relationship-edge', role: 'aggregation' },
  'uml-composition': { notation: 'uml', family: 'uml.relationship-edge', role: 'composition' },
  'uml-generalization': { notation: 'uml', family: 'uml.relationship-edge', role: 'generalization' },
  'uml-dependency': { notation: 'uml', family: 'uml.relationship-edge', role: 'dependency' },
  'uml-realization': { notation: 'uml', family: 'uml.relationship-edge', role: 'realization' },
  'uml-usage': { notation: 'uml', family: 'uml.relationship-edge', role: 'usage' },
  'uml-assembly-connector': { notation: 'uml', family: 'uml.interface-edge', role: 'assembly connector' },
  'uml.sequence-message': { notation: 'uml', family: 'uml.sequence-edge', role: 'message' },
  'uml.create-message': { notation: 'uml', family: 'uml.sequence-edge', role: 'create message' },
  'uml.return-message': { notation: 'uml', family: 'uml.sequence-edge', role: 'return message' },
  'uml.state-transition': { notation: 'uml', family: 'uml.state-edge', role: 'state transition' },
  'uml.activity-flow': { notation: 'uml', family: 'uml.activity-edge', role: 'control flow' },

  'erd.entity': { notation: 'erd', family: 'erd.entity', role: 'entity', connectionGroups: ['erd.entity'] },
  'erd.weak-entity': { notation: 'erd', family: 'erd.entity', role: 'weak entity', connectionGroups: ['erd.entity'] },
  'erd.associative-entity': { notation: 'erd', family: 'erd.entity', role: 'associative entity', connectionGroups: ['erd.entity'] },
  'erd.relationship': { notation: 'erd', family: 'erd.chen-relationship', role: 'relationship diamond' },
  'erd.identifying-relationship': { notation: 'erd', family: 'erd.chen-relationship', role: 'identifying relationship diamond' },
  'erd.attribute': { notation: 'erd', family: 'erd.attribute', role: 'attribute', connectionGroups: ['erd.attribute'] },
  'erd.primary-key-attribute': { notation: 'erd', family: 'erd.attribute', role: 'primary-key attribute', connectionGroups: ['erd.attribute'] },
  'erd.foreign-key-attribute': { notation: 'erd', family: 'erd.attribute', role: 'foreign-key attribute', connectionGroups: ['erd.attribute'] },
  'erd.multivalued-attribute': { notation: 'erd', family: 'erd.attribute', role: 'multivalued attribute', connectionGroups: ['erd.attribute'] },
  'erd.derived-attribute': { notation: 'erd', family: 'erd.attribute', role: 'derived attribute', connectionGroups: ['erd.attribute'] },
  'erd.database': { notation: 'erd', family: 'erd.storage', role: 'database' },
  'erd.table': { notation: 'erd', family: 'erd.entity', role: 'retained generic table', connectionGroups: ['erd.entity'] },
  'erd.er-table': { notation: 'erd', family: 'erd.entity', role: 'structured table entity', connectionGroups: ['erd.entity'] },
  'erd.column': { notation: 'erd', family: 'erd.attribute', role: 'table column' },
  'erd.key-marker': { notation: 'erd', family: 'erd.key-glyph', role: 'key marker' },
  'erd.relationship-connector': { notation: 'erd', family: 'erd.relationship-edge', role: 'ER relationship with endpoint cardinality' },

  'bpmn.sequence-flow': { notation: 'bpmn', family: 'bpmn.edge', role: 'sequence flow' },
  'bpmn.message-flow': { notation: 'bpmn', family: 'bpmn.edge', role: 'message flow' },
  'bpmn.association': { notation: 'bpmn', family: 'bpmn.edge', role: 'association' },
  'bpmn.data-association': { notation: 'bpmn', family: 'bpmn.edge', role: 'data association' },
  'bpmn.start-event': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'start event', connectionGroups: ['bpmn.flow-node'] },
  'bpmn.intermediate-event': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'intermediate event', connectionGroups: ['bpmn.flow-node'] },
  'bpmn.end-event': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'end event', connectionGroups: ['bpmn.flow-node'] },
  'bpmn.message-event': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'message event', connectionGroups: ['bpmn.flow-node'] },
  'bpmn.timer-event': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'timer event', connectionGroups: ['bpmn.flow-node'] },
  'bpmn.error-event': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'error event', connectionGroups: ['bpmn.flow-node'] },
  'bpmn.signal-event': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'signal event', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-user-task': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'user task', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-manual-task': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'manual task', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-service-task': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'service task', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-script-task': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'script task', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-business-rule-task': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'business-rule task', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-receive-task': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'receive task', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-send-task': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'send task', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-call-activity': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'call activity', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-subprocess': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'subprocess', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-exclusive-gateway': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'exclusive gateway', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-inclusive-gateway': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'inclusive gateway', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-parallel-gateway': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'parallel gateway', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-event-gateway': { notation: 'bpmn', family: 'bpmn.flow-node', role: 'event gateway', connectionGroups: ['bpmn.flow-node'] },
  'bpmn-data-object': { notation: 'bpmn', family: 'bpmn.artifact', role: 'data object', connectionGroups: ['bpmn.artifact'] },
  'bpmn-data-store': { notation: 'bpmn', family: 'bpmn.artifact', role: 'data store', connectionGroups: ['bpmn.artifact'] },
  'bpmn-message': { notation: 'bpmn', family: 'bpmn.artifact', role: 'message artifact', connectionGroups: ['bpmn.artifact'] },
  'bpmn-pool': { notation: 'bpmn', family: 'bpmn.participant', role: 'pool / participant', connectionGroups: ['bpmn.pool'], container: { accepts: ['bpmn.lane', 'bpmn.flow-node', 'bpmn.artifact'] } },
  'bpmn-lane': { notation: 'bpmn', family: 'bpmn.container', role: 'lane', connectionGroups: ['bpmn.lane'], container: { accepts: ['bpmn.flow-node', 'bpmn.artifact'] } },
  'bpmn-group': { notation: 'bpmn', family: 'bpmn.visual-group', role: 'group outline' },
  'bpmn-annotation': { notation: 'bpmn', family: 'bpmn.artifact', role: 'text annotation', connectionGroups: ['bpmn.artifact'] },

  '3d.cube': { notation: '3d', family: 'solid.box', role: 'cube' },
  '3d.cuboid': { notation: '3d', family: 'solid.box', role: 'cuboid' },
  '3d.cylinder': { notation: '3d', family: 'solid.revolved', role: 'cylinder' },
  '3d.cone': { notation: '3d', family: 'solid.revolved', role: 'cone' },
  '3d.sphere': { notation: '3d', family: 'solid.revolved', role: 'sphere' },
  '3d.pyramid': { notation: '3d', family: 'solid.pyramid', role: 'square pyramid' },
  '3d.quadrilateral-pyramid': { notation: '3d', family: 'solid.pyramid', role: 'convex quadrilateral pyramid' },
  '3d.tetrahedron': { notation: '3d', family: 'solid.polyhedron', role: 'regular tetrahedron' },
  '3d.right-tetrahedron': { notation: '3d', family: 'solid.polyhedron', role: 'right tetrahedron with perpendicular altitude' },
  '3d.octahedron': { notation: '3d', family: 'solid.polyhedron', role: 'octahedron' },
  '3d.triangular-prism': { notation: '3d', family: 'solid.prism', role: 'triangular prism' },
  '3d.quadrilateral-prism': { notation: '3d', family: 'solid.prism', role: 'convex quadrilateral prism' },
  '3d.pentagonal-prism': { notation: '3d', family: 'solid.prism', role: 'pentagonal prism' },
  '3d.hexagonal-prism': { notation: '3d', family: 'solid.prism', role: 'hexagonal prism' },
  '3d.square-prism': { notation: '3d', family: 'solid.prism', role: 'square prism' },
  '3d.pentagonal-pyramid': { notation: '3d', family: 'solid.pyramid', role: 'pentagonal pyramid' },
  '3d.hexagonal-pyramid': { notation: '3d', family: 'solid.pyramid', role: 'hexagonal pyramid' },
  '3d.pyramid-frustum': { notation: '3d', family: 'solid.pyramid', role: 'truncated pyramid / pyramid frustum' },
  '3d.cone-frustum': { notation: '3d', family: 'solid.revolved', role: 'cone frustum / truncated cone' },
};

export interface ConnectorEndpointPairRule {
  readonly source: readonly string[];
  readonly target: readonly string[];
  /** The same pair may be attached in either order for undirected/ER-style relationships. */
  readonly reverse?: boolean;
}

export interface ConnectorEndpointRule {
  readonly pairs: readonly ConnectorEndpointPairRule[];
}

/** Minimal supported rules justified by the current symbols/markers; not an execution schema. */
export const CONNECTOR_ENDPOINT_RULES: Readonly<Record<ConnectorRuleId, ConnectorEndpointRule>> = {
  generic: { pairs: [] },
  'uml-association': { pairs: [
    { source: ['uml.usecase.actor'], target: ['uml.usecase.use-case'], reverse: true },
    { source: ['uml.classifier'], target: ['uml.classifier'], reverse: true },
  ] },
  'uml-usecase-dependency': { pairs: [{ source: ['uml.usecase.use-case'], target: ['uml.usecase.use-case'] }] },
  'uml-class-directed': { pairs: [{ source: ['uml.classifier'], target: ['uml.classifier'] }] },
  'uml-generalization': { pairs: [
    { source: ['uml.classifier'], target: ['uml.classifier'] },
    { source: ['uml.usecase.actor'], target: ['uml.usecase.actor'] },
    { source: ['uml.usecase.use-case'], target: ['uml.usecase.use-case'] },
  ] },
  'uml-aggregation': { pairs: [{ source: ['uml.classifier'], target: ['uml.classifier'] }] },
  'uml-composition': { pairs: [{ source: ['uml.classifier'], target: ['uml.classifier'] }] },
  'uml-dependency': { pairs: [{ source: ['uml.classifier'], target: ['uml.classifier'] }] },
  'uml-realization': { pairs: [{ source: ['uml.classifier', 'uml.component'], target: ['uml.interface'] }] },
  'uml-usage': { pairs: [{ source: ['uml.classifier'], target: ['uml.classifier'] }] },
  'uml-assembly': { pairs: [{ source: ['uml.interface.provided'], target: ['uml.interface.required'], reverse: true }] },
  'uml-sequence-message': { pairs: [{ source: ['uml.sequence.participant'], target: ['uml.sequence.participant'] }] },
  'uml-create-message': { pairs: [{ source: ['uml.sequence.participant'], target: ['uml.sequence.lifeline'] }] },
  'uml-state-transition': { pairs: [{ source: ['uml.state.vertex'], target: ['uml.state.vertex'] }] },
  'uml-activity-flow': { pairs: [{ source: ['uml.activity.node'], target: ['uml.activity.node'] }] },
  'erd-relationship': { pairs: [{ source: ['erd.entity'], target: ['erd.entity'], reverse: true }] },
  'bpmn-sequence-flow': { pairs: [{ source: ['bpmn.flow-node'], target: ['bpmn.flow-node'] }] },
  'bpmn-message-flow': { pairs: [{ source: ['bpmn.pool'], target: ['bpmn.pool'] }] },
  'bpmn-association': { pairs: [{ source: ['bpmn.flow-node'], target: ['bpmn.artifact'], reverse: true }] },
  'bpmn-data-association': { pairs: [{ source: ['bpmn.flow-node'], target: ['bpmn.artifact'], reverse: true }] },
};

export const CONNECTOR_RULE_BY_ID: Readonly<Record<string, ConnectorRuleId>> = {
  'uml-association': 'uml-association',
  'uml-directed-association': 'uml-association',
  'uml.include': 'uml-usecase-dependency',
  'uml.extend': 'uml-usecase-dependency',
  'uml-aggregation': 'uml-aggregation',
  'uml-composition': 'uml-composition',
  'uml-generalization': 'uml-generalization',
  'uml-dependency': 'uml-dependency',
  'uml-realization': 'uml-realization',
  'uml-usage': 'uml-usage',
  'uml-assembly-connector': 'uml-assembly',
  'uml.sequence-message': 'uml-sequence-message',
  'uml.return-message': 'uml-sequence-message',
  'uml.create-message': 'uml-create-message',
  'uml.state-transition': 'uml-state-transition',
  'uml.activity-flow': 'uml-activity-flow',
  'erd.relationship-connector': 'erd-relationship',
  'bpmn.sequence-flow': 'bpmn-sequence-flow',
  'bpmn.message-flow': 'bpmn-message-flow',
  'bpmn.association': 'bpmn-association',
  'bpmn.data-association': 'bpmn-data-association',
};

const intersects = (left: readonly string[], right: readonly string[]) => left.some(group => right.includes(group));

export function connectorEndpointSideAllowed(
  connector: ShapeDefinition,
  endpoint: ShapeDefinition | undefined,
  side: EndpointSide,
): boolean {
  if (connector.kind !== 'connector' || connector.connectorRule === 'generic' || !connector.connectorRule) return true;
  const groups = endpoint?.semantic?.connectionGroups ?? [];
  if (!groups.length) return false;
  const rule = CONNECTOR_ENDPOINT_RULES[connector.connectorRule];
  return rule.pairs.some(pair => side === 'source'
    ? intersects(groups, pair.source) || (pair.reverse === true && intersects(groups, pair.target))
    : intersects(groups, pair.target) || (pair.reverse === true && intersects(groups, pair.source)));
}

export function connectorEndpointPairAllowed(
  connector: ShapeDefinition,
  source: ShapeDefinition | undefined,
  target: ShapeDefinition | undefined,
): boolean {
  if (connector.kind !== 'connector' || connector.connectorRule === 'generic' || !connector.connectorRule) return true;
  const sourceGroups = source?.semantic?.connectionGroups ?? [];
  const targetGroups = target?.semantic?.connectionGroups ?? [];
  if (!sourceGroups.length || !targetGroups.length) return false;
  return CONNECTOR_ENDPOINT_RULES[connector.connectorRule].pairs.some(pair => {
    const direct = intersects(sourceGroups, pair.source) && intersects(targetGroups, pair.target);
    const reverse = pair.reverse === true && intersects(sourceGroups, pair.target) && intersects(targetGroups, pair.source);
    return direct || reverse;
  });
}

export function containerAcceptsSemanticChild(container: ShapeDefinition, child: ShapeDefinition): boolean {
  const accepts = container.semantic?.container?.accepts ?? [];
  const childGroups = child.semantic?.connectionGroups ?? [];
  return accepts.length > 0 && childGroups.length > 0 && intersects(accepts, childGroups);
}
