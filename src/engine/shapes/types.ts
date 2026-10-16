export const SHAPE_CATEGORIES = [
  'Basic',
  '3D Shapes',
  'ERD / Database',
  'Use Case Diagram',
  'Class Diagram',
  'Sequence Diagram',
  'Activity Diagram',
  'State Diagram',
] as const;

/** Hidden taxonomy retained only so legacy Flowchart definitions remain renderable on old boards. */
export type ShapeCategory = typeof SHAPE_CATEGORIES[number] | 'Flowchart';
export type ShapeKind = 'shape' | 'connector';

/** Shared native path primitives used by semantic definitions across all libraries. */
export type GeometryKind =
  | 'rect' | 'roundedRect' | 'capsule' | 'ellipse' | 'triangle' | 'rightTriangle' | 'diamond' | 'callout'
  | 'parallelogram' | 'trapezoid' | 'regularPolygon' | 'star' | 'cross'
  | 'heart' | 'cloud' | 'cylinder' | 'document' | 'multipleDocuments'
  | 'actor' | 'frame' | 'package' | 'note' | 'blockArrow' | 'internalStorage'
  | 'manualInput' | 'manualOperation' | 'preparation' | 'display' | 'delay'
  | 'offPage' | 'magneticTape' | 'summingJunction' | 'collate' | 'sort'
  | 'extract' | 'merge' | 'predefinedProcess' | 'magneticDisk' | 'useCase' | 'umlBoundary' | 'umlLifeline'
  | 'umlActorParticipant' | 'umlActivation' | 'umlRole' | 'umlDestroy' | 'umlState' | 'umlCompositeState'
  | 'umlInitialState' | 'umlFinalState' | 'umlFork' | 'umlActivity' | 'umlPseudoChoice' | 'umlHistory'
  | 'umlEntryPoint' | 'umlExitPoint' | 'umlProvidedInterface' | 'umlRequiredInterface' | 'activityPartition'
  | 'bpmnEvent' | 'bpmnTask'
  | 'bpmnGateway' | 'dataObject' | 'dataStore' | 'pool' | 'lane' | 'group'
  | 'annotation' | 'table' | 'column' | 'keyMarker' | 'junction' | 'waypoint' | 'associativeEntity'
  | 'cube3d' | 'cuboid3d' | 'cylinder3d' | 'cone3d' | 'sphere3d' | 'pyramid3d' | 'quadrilateralPyramid3d'
  | 'tetrahedron3d' | 'rightTetrahedron3d' | 'octahedron3d' | 'triangularPrism3d' | 'quadrilateralPrism3d'
  | 'pentagonalPrism3d' | 'hexagonalPrism3d' | 'squarePrism3d' | 'pentagonalPyramid3d'
  | 'hexagonalPyramid3d' | 'pyramidFrustum3d' | 'coneFrustum3d'
  | 'rightQuadrilateralPyramid3d' | 'rightTrapezoidPyramid3d' | 'rightTrapezoidPerpendicularPyramid3d';

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type ConnectorRouteKind = 'straight' | 'curved' | 'orthogonal' | 'elbow';
export type ConnectorRuleId =
  | 'generic'
  | 'uml-association' | 'uml-usecase-dependency' | 'uml-class-directed' | 'uml-generalization'
  | 'uml-aggregation' | 'uml-composition' | 'uml-dependency' | 'uml-realization' | 'uml-usage'
  | 'uml-assembly' | 'uml-sequence-message' | 'uml-create-message' | 'uml-state-transition' | 'uml-activity-flow' | 'uml-object-flow'
  | 'erd-relationship' | 'bpmn-sequence-flow' | 'bpmn-message-flow' | 'bpmn-association' | 'bpmn-data-association';
export type Solid3DFamily = 'box' | 'revolved' | 'pyramid' | 'prism' | 'polyhedron';
export type ShapeParameterValue = number | string | boolean;
export type ShapeParameterStatus = 'user-editable' | 'internal' | 'derived' | 'legacy';
export type ShapeDataCapability = 'classifier' | 'instance' | 'table' | 'column' | 'usecase';

export type UMLClassifierKind = 'class' | 'abstract-class' | 'interface' | 'enumeration' | 'object';
export type UMLVisibility = 'public' | 'protected' | 'package' | 'private';
export type UMLClassifierCompartmentKind = 'attributes' | 'operations' | 'literals' | 'values';

export interface UMLClassifierParameter {
  id: string;
  name: string;
  type?: string;
  defaultValue?: string;
}

export interface UMLClassifierAttribute {
  id: string;
  kind: 'attribute';
  name: string;
  visibility?: UMLVisibility;
  type?: string;
  defaultValue?: string;
  derived?: boolean;
  static?: boolean;
  /** Exact legacy row text retained until the user edits this member. */
  sourceText?: string;
}

export interface UMLClassifierOperation {
  id: string;
  kind: 'operation';
  name: string;
  visibility?: UMLVisibility;
  parameters: UMLClassifierParameter[];
  returnType?: string;
  abstract?: boolean;
  static?: boolean;
  /** Exact legacy row text retained until the user edits this member. */
  sourceText?: string;
}

export interface UMLClassifierLiteral {
  id: string;
  kind: 'literal';
  name: string;
  /** Exact legacy row text retained until the user edits this member. */
  sourceText?: string;
}

export interface UMLInstanceValue {
  id: string;
  kind: 'value';
  name: string;
  value?: string;
  type?: string;
  /** Exact legacy row text retained until the user edits this member. */
  sourceText?: string;
}

export type UMLClassifierMember = UMLClassifierAttribute | UMLClassifierOperation | UMLClassifierLiteral;

export interface UMLClassifierCompartment {
  id: string;
  kind: UMLClassifierCompartmentKind;
  label: string;
  items: UMLClassifierMember[];
}

export interface UMLClassifierData {
  version: 2;
  kind: UMLClassifierKind;
  compartments: UMLClassifierCompartment[];
  /** Preserved semantic extension fields from older boards are allowed. */
  [key: string]: unknown;
}

export interface UMLInstanceData {
  version: 2;
  kind: 'object';
  values: UMLInstanceValue[];
  [key: string]: unknown;
}

export interface UMLExtensionPoint {
  id: string;
  name: string;
  explanation?: string;
}

export interface UMLUseCaseData {
  version: 1;
  stereotype?: string;
  extensionPoints?: UMLExtensionPoint[];
  isBusinessUseCase?: boolean;
}

export interface UMLSubjectBoundaryData {
  version: 1;
  stereotype?: string;
}

export interface UMLExtendRelationshipData {
  version: 1;
  condition?: string;
  extensionPoint?: string;
}

/** The five UML diagram families whose graphs are interpreted by the shared foundation. */
export const UML_DIAGRAM_FAMILIES = ['use-case', 'class', 'sequence', 'state', 'activity'] as const;
export const UML_FOUNDATION_SCHEMA_VERSION = 3;
export type UMLDiagramFamily = typeof UML_DIAGRAM_FAMILIES[number];
export type DiagramContextId = UMLDiagramFamily | 'freeform' | 'mixed';
export type ConnectionPointKind = 'fixed' | 'floating' | 'relative' | 'structured' | 'sequence-time' | 'special';
export type SequenceMessageKind = 'synchronous' | 'asynchronous' | 'return' | 'create' | 'self-call' | 'lost' | 'found';
export type SequenceFragmentOperator =
  | 'alt' | 'opt' | 'loop' | 'par' | 'critical' | 'break' | 'seq' | 'strict' | 'neg' | 'assert' | 'ignore' | 'consider';

export type UMLStatePointSide = 'north' | 'east' | 'south' | 'west';
export type UMLActivityPartitionOrientation = 'vertical' | 'horizontal';
export type UMLActivityFlowKind = 'control' | 'object';

/** Named semantic region owned by one composite state. Region membership is independent of scale/layout. */
export interface UMLStateRegion {
  id: string;
  name: string;
  order: number;
}

export interface UMLStateBehaviorData {
  version: 1;
  stateId: string;
  entry: string;
  doActivity: string;
  exit: string;
}

export interface UMLStateCompositeData {
  version: 1;
  stateId: string;
  regions: UMLStateRegion[];
}

export interface UMLStateVertexData {
  version: 1;
  vertexId: string;
  /** The root state region is the stable literal `region:root`; nested vertices refer to an owner region. */
  regionId: string;
}

/** Owned Entry/Exit/History pseudostate metadata; side/offset are used by border points. */
export interface UMLStatePointData {
  version: 1;
  pointId: string;
  ownerStateId?: string;
  side?: UMLStatePointSide;
  /** Normalized attachment position along the selected composite-state side, in permille. */
  offsetPermille?: number;
}

export interface UMLActivityNodeData {
  version: 1;
  nodeId: string;
  /** Mirrors direct Activity Partition ownership; `containerId` remains the canonical owner link. */
  partitionId?: string;
}

export interface UMLActivityPartitionData {
  version: 1;
  partitionId: string;
  orientation: UMLActivityPartitionOrientation;
}

export interface UMLActivityFlowData {
  version: 1;
  kind: UMLActivityFlowKind;
  guard?: string;
}

/** Stable event semantics; board-space Y is a display ordinate, never the event identity/order. */
export interface SequenceMessageEventData {
  version: 1;
  eventId: string;
  messageId: string;
  order: number;
  visualY: number;
  /** Receiver occurrence row; differs from visualY for a vertically returning self-call. */
  targetVisualY?: number;
  kind: SequenceMessageKind;
  selfCall?: boolean;
  sourceOccurrenceId: string;
  targetOccurrenceId: string;
  sourceEndpointId?: string;
  targetEndpointId?: string;
  sourceParticipantId?: string;
  targetParticipantId?: string;
  returnForMessageId?: string;
  timelineId?: string;
  fragmentId?: string;
  operandId?: string;
}

export interface SequenceParticipantData {
  version: 1;
  participantId: string;
  createdByMessageId?: string;
  createdAtOrder?: number;
  destroyedByEventId?: string;
  destroyedAtOrder?: number;
}

export interface SequenceActivationData {
  version: 1;
  activationId: string;
  participantId?: string;
  /** Positive logical duration, kept independent of lifeline and activation box resizing. */
  duration: number;
  startOccurrenceId?: string;
  endOccurrenceId?: string;
  startOrder?: number;
  endOrder?: number;
}

export interface SequenceLifecycleData {
  version: 1;
  lifecycleId: string;
  participantId?: string;
  kind: 'destroy';
  visualY: number;
  order?: number;
}

export interface SequenceFragmentOperand {
  id: string;
  order: number;
  guard: string;
}

export interface SequenceFragmentData {
  version: 1;
  operator: SequenceFragmentOperator;
  operands: SequenceFragmentOperand[];
}
export type UMLTypographyRole = 'actor' | 'use-case' | 'classifier' | 'sequence-participant' | 'sequence-object'
  | 'container-title' | 'state' | 'pseudostate' | 'activity-action' | 'object-node' | 'partition-title' | 'connector-label';

export interface DiagramNotationCapabilities {
  readonly transform?: {
    readonly resize?: boolean;
    readonly resizeX?: boolean;
    readonly resizeY?: boolean;
    readonly aspectLocked?: boolean;
    readonly aspectRatio?: number;
    readonly fixedSize?: boolean;
    readonly rotate?: boolean;
  };
  readonly style?: { readonly fill?: boolean; readonly stroke?: boolean; readonly strokeWidth?: boolean; readonly textColor?: boolean; readonly fontSize?: boolean };
  readonly text?: { readonly editable?: boolean; readonly autoGrow?: boolean; readonly minFontSize?: number; readonly role?: UMLTypographyRole };
  readonly connector?: {
    readonly labelMode?: 'none' | 'fixed' | 'plain' | 'structured';
    readonly lineStyleEditable?: boolean;
    readonly markersEditable?: boolean;
    /** Legacy finite cardinality marker controls remain for compatibility-only connectors. */
    readonly cardinalityEditable?: boolean;
    /** Arbitrary UML multiplicity text at source/target; independent from role labels. */
    readonly multiplicityEditable?: boolean;
    readonly sourceLabelEditable?: boolean;
    readonly targetLabelEditable?: boolean;
    readonly sourceRoleLabel?: string;
    readonly targetRoleLabel?: string;
    /** Human-readable source-to-target interpretation shown in the semantic editor. */
    readonly directionText?: string;
    readonly ownerSide?: EndpointSide;
    readonly routeEditable?: boolean;
    readonly labelPositionEditable?: boolean;
  };
}

export interface ShapeParameterOption {
  readonly value: ShapeParameterValue;
  readonly label: string;
}

export type ShapeParameterControl =
  | { readonly type: 'range'; readonly min: number; readonly max: number; readonly step: number; readonly unit?: string; readonly precision?: number }
  | { readonly type: 'select'; readonly options: readonly ShapeParameterOption[] }
  | { readonly type: 'checkbox' }
  | { readonly type: 'text'; readonly maxLength?: number; readonly placeholder?: string };

/** Reusable editor/verification metadata; status prevents derived or compatibility state leaking into the UI. */
export interface ShapeParameterMetadata {
  readonly key: string;
  readonly label: string;
  readonly status: ShapeParameterStatus;
  readonly description: string;
  readonly defaultValue: ShapeParameterValue;
  readonly control?: ShapeParameterControl;
  /** The picker preview is a compact symbol, not a live property preview. */
  readonly previewImpact: 'geometry' | 'style' | 'label' | 'none';
}

/** Declarative semantic capabilities consumed by the shared endpoint/container rules. */
export type BehavioralNodeRole = 'decision' | 'merge' | 'fork' | 'join' | 'choice' | 'junction';

export interface FlowDegreeRule {
  readonly minIncoming?: number;
  readonly maxIncoming?: number;
  readonly minOutgoing?: number;
  readonly maxOutgoing?: number;
}

export interface ShapeSemanticMetadata {
  readonly notation: 'uml' | 'erd' | 'bpmn' | 'flow' | '3d';
  readonly family: string;
  readonly role: string;
  /** Stable reusable groups used by connector rules, not shape-id conditionals. */
  readonly connectionGroups?: readonly string[];
  /** Shared native endpoint layouts for semantic substructure such as lifelines and table rows. */
  readonly connectionPointProvider?: 'sequence-lifeline' | 'sequence-activation' | 'uml-behavior-vertex' | 'structured-table-rows';
  /** Diagram families this role may belong to; shared glyphs list both valid interpretations. */
  readonly diagramFamilies?: readonly UMLDiagramFamily[];
  /** Explicit frame/container roots provide context to otherwise ambiguous or disconnected fragments. */
  readonly contextRoot?: boolean;
  /** Centralized generic transform/style/text/connector policy for UML notation objects. */
  readonly capabilities?: DiagramNotationCapabilities;
  /** Context-specific capability overrides for glyphs shared by multiple UML diagram families. */
  readonly contextCapabilities?: Partial<Record<UMLDiagramFamily, DiagramNotationCapabilities>>;
  /** Existing dual-role UML glyphs retain an explicit, persisted role on each instance. */
  readonly behavioralNodeRoles?: readonly BehavioralNodeRole[];
  readonly defaultBehavioralNodeRole?: BehavioralNodeRole;
  /** Per-role directed-flow cardinality; minimums are validated, maximums also guide snapping. */
  readonly nodeFlowRules?: Readonly<Partial<Record<BehavioralNodeRole | 'initial' | 'final', FlowDegreeRule>>>;
  /** A true logical parent relationship; this is distinct from a dashed/visual group outline. */
  readonly container?: { readonly accepts: readonly string[] };
}

export type EndpointSide = 'source' | 'target';

export type EndpointMarker =
  | 'none' | 'arrow' | 'openArrow' | 'blockArrow' | 'hollowTriangle'
  | 'diamond' | 'filledDiamond' | 'circle' | 'filledCircle' | 'bar' | 'crowFoot'
  | 'zeroOrOne' | 'oneOrMany' | 'zeroOrMany';
export type Cardinality = 'one' | 'zero-or-one' | 'many' | 'one-or-many' | 'zero-or-many';

/** Common resize behavior for definitions whose dimensions have a stable relationship. */
export type ShapeResizePolicy =
  | { readonly mode: 'free' }
  | { readonly mode: 'horizontal' }
  | { readonly mode: 'vertical' }
  | { readonly mode: 'aspect'; readonly aspectRatio: number };

export interface ShapeDefinition {
  readonly id: string;
  /** Public tool id; intentionally separate from semantic id and persisted legacy type. */
  readonly toolId: string;
  readonly label: string;
  readonly category: ShapeCategory;
  readonly kind: ShapeKind;
  readonly geometry: GeometryKind;
  readonly description: string;
  readonly width: number;
  readonly height: number;
  /** Audited semantic-family capabilities; absent on generic primitives. */
  readonly semantic?: ShapeSemanticMetadata;
  /** Declarative connector endpoint policy; generic connectors remain unrestricted. */
  readonly connectorRule?: ConnectorRuleId;
  /** Shared routing family used by drawing, hit testing, previews and bounds. */
  readonly routeKind?: ConnectorRouteKind;
  /** Shared mesh family for parametric 3D solids. */
  readonly solid3d?: { readonly family: Solid3DFamily };
  readonly legacyType?: string;
  /** Preferred explicit resize capability; legacy aspectLocked remains a square-only fallback. */
  readonly resizePolicy?: ShapeResizePolicy;
  /** @deprecated Use resizePolicy: { mode: 'aspect', aspectRatio: 1 } for new definitions. */
  readonly aspectLocked?: boolean;
  readonly defaultFill?: string;
  readonly defaultStroke?: string;
  readonly defaultStrokeWidth?: number;
  readonly defaultText?: string;
  /** Initial text attached to semantic relationships such as UML include/extend/use. */
  readonly defaultLabel?: string;
  readonly defaultParams?: Readonly<Record<string, number | string | boolean>>;
  /** Canonical local XYZ dimensions for 3D solids; projected canvas bounds are always derived. */
  readonly defaultScale3d?: Readonly<{ x: number; y: number; z: number }>;
  /** Metadata is derived once from defaults and shared by the generic property editor and audits. */
  readonly parameterMetadata?: readonly ShapeParameterMetadata[];
  /** Structured editor capabilities (classifier/table/column) derived from semantic default data. */
  readonly dataCapabilities?: readonly ShapeDataCapability[];
  readonly defaultData?: Readonly<Record<string, unknown>>;
  readonly connector?: Readonly<{
    lineStyle?: StrokeStyle;
    startMarker?: EndpointMarker;
    endMarker?: EndpointMarker;
    sourceCardinality?: Cardinality;
    targetCardinality?: Cardinality;
    erdParticipation?: 'partial' | 'total';
  }>;
  /** False only for retained compatibility definitions that must not appear in the picker. */
  readonly pickerVisible?: boolean;
  /** Additional libraries in which this same semantic definition is discoverable. */
  readonly pickerCategories?: readonly ShapeCategory[];
  /** Context-aware display names for cross-listed semantic tools. */
  readonly pickerLabels?: Partial<Record<ShapeCategory, string>>;
  /** User-facing synonyms and explicit legacy migrations; hidden compatibility definitions are never indexed as choices. */
  readonly searchAliases?: readonly string[];
  /** Domain vocabulary not fully represented by the visible label or semantic role. */
  readonly searchKeywords?: readonly string[];
  /** Compact symbol shown in the category picker; rendered with native inline SVG. */
  readonly preview?: string;
  /** Small distinguishing glyph layered over a shared canonical preview (for example B/C/E or FK). */
  readonly previewGlyph?: string;
}

export type ShapeToolId = typeof import('./registry').SHAPE_DEFINITIONS[number]['toolId'];

export interface PathCommand {
  op: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'ellipse' | 'closePath';
  values: number[];
}

export interface TableColumnModel {
  id: string;
  name: string;
  type: string;
  key?: 'none' | 'primary' | 'foreign' | 'primary_foreign' | 'unique';
  nullable?: boolean;
  default?: string;
  comment?: string;
}

export interface TableShapeData {
  columns: TableColumnModel[];
  schema?: string;
  comment?: string;
}

export interface DiagramData {
  [key: string]: unknown;
  table?: TableShapeData;
  column?: TableColumnModel;
  sequenceParticipant?: SequenceParticipantData;
  sequenceActivation?: SequenceActivationData;
  sequenceLifecycle?: SequenceLifecycleData;
  sequenceFragment?: SequenceFragmentData;
  stateBehavior?: UMLStateBehaviorData;
  stateComposite?: UMLStateCompositeData;
  stateVertex?: UMLStateVertexData;
  statePoint?: UMLStatePointData;
  activityNode?: UMLActivityNodeData;
  activityPartition?: UMLActivityPartitionData;
  usecase?: UMLUseCaseData;
  subjectBoundary?: UMLSubjectBoundaryData;
}

export interface ShapeConnectionPoint {
  id: 'top' | 'right' | 'bottom' | 'left' | 'center' | string;
  x: number;
  y: number;
  kind: ConnectionPointKind;
}

export interface ShapeEndpointReference {
  shapeId: string;
  pointId: string;
  /** Stable attachment semantics; omitted on older boards and safely inferred from pointId. */
  kind?: ConnectionPointKind;
}

export type EndpointReferenceIssue = 'malformed' | 'missing-shape-id' | 'missing-point-id' | 'oversized';
export type EndpointIntent = 'attached' | 'free' | 'pending';

export interface DiagramShapeObject {
  id: string;
  type: 'diagram';
  shapeId: string;
  x: number; y: number; w: number; h: number;
  rotation: number;
  fill: string; stroke: string; sw: number;
  text?: string; fs?: number; textColor?: string;
  params: Record<string, unknown>;
  /** Persisted context for a UML object when a glyph is valid in multiple families. */
  diagramContext?: UMLDiagramFamily;
  /** Per-record foundation schema marker used for deterministic legacy-board migration. */
  umlSchemaVersion?: number;
  /** Instance role for catalogued dual-role UML glyphs (Decision/Merge, Fork/Join, Choice/Junction). */
  behavioralRole?: BehavioralNodeRole;
  /** Legacy non-UML embedded-label scale; UML typography is canonical and ignores this field. */
  embeddedTextScale?: number;
  /** Independent local X/Y/Z dimension factors applied to 3D vertices before XYZ rotation; omitted on legacy records. */
  scale3d?: { x: number; y: number; z: number };
  /** Versioned 3D local-pose migration marker; omitted by legacy records. */
  solid3dPoseVersion?: number;
  data?: DiagramData;
  /** Stable semantic ownership edge for nested UML/BPMN containers. */
  containerId?: string;
  minX: number; minY: number; maxX: number; maxY: number;
}

export interface StateTransitionParts {
  trigger?: string;
  guard?: string;
  effect?: string;
  /** Stable owning State Region when both endpoint intents resolve within one region. */
  regionId?: string;
}

export interface ConnectorShapeObject {
  id: string;
  type: 'connector';
  shapeId: string;
  x1: number; y1: number; x2: number; y2: number;
  waypoints: [number, number][];
  color: string; sw: number;
  lineStyle: StrokeStyle;
  startMarker: EndpointMarker; endMarker: EndpointMarker;
  sourceCardinality?: Cardinality; targetCardinality?: Cardinality;
  /** Arbitrary, exact UML multiplicity text. Kept separate from role/end labels. */
  sourceMultiplicity?: string; targetMultiplicity?: string;
  sourceRef?: ShapeEndpointReference; targetRef?: ShapeEndpointReference;
  /** Malformed legacy refs remain explicitly invalid instead of disappearing into free coordinates. */
  invalidEndpointRefs?: Partial<Record<EndpointSide, EndpointReferenceIssue>>;
  /** User intent survives free-end edits and load; pending is transient during an active gesture. */
  sourceIntent?: EndpointIntent;
  targetIntent?: EndpointIntent;
  /** Persisted context for connectors shared by more than one UML family. */
  diagramContext?: UMLDiagramFamily;
  /** Per-record foundation schema marker used for deterministic legacy-board migration. */
  umlSchemaVersion?: number;
  /** Center relationship label (legacy/fallback connector label). */
  label?: string;
  /** Independent source/target role labels for Class relationships. */
  sourceLabel?: string; targetLabel?: string;
  /** Route-relative label locations in permille (0..1000); offsets persist through rerouting. */
  labelPosition?: number;
  labelOffset?: number;
  sourceLabelPosition?: number;
  sourceLabelOffset?: number;
  targetLabelPosition?: number;
  targetLabelOffset?: number;
  /** Legacy display-ordinate mirror; canonical Sequence identity/order live in sequenceEvent. */
  sequenceTime?: number;
  /** Persisted event and occurrence identity, logical order, endpoint ownership, and fragment links. */
  sequenceEvent?: SequenceMessageEventData;
  /** Connector ownership is used only by catalogued Sequence frames; endpoints may remain attached outside it. */
  containerId?: string;
  /** Stable semantic ordering token for UML relationship lane allocation; never derived from random IDs. */
  parallelOrder?: number;
  /** Stable local offset for parallel behavioral edges and sequence self-messages; omitted for legacy/manual routes. */
  parallelLane?: number;
  /** Structured transition notation; generic `label` remains the legacy/fallback representation. */
  stateTransition?: StateTransitionParts;
  /** Activity Control/Object Flow is explicit and independent from State Transition semantics. */
  activityFlow?: UMLActivityFlowData;
  /** Use Case Extend dependency condition and referenced extension point. */
  usecaseExtend?: UMLExtendRelationshipData;
  /** Chen ERD: 'total' renders parallel double lines (3.5px gap); 'partial' or undefined renders a single line. */
  erdParticipation?: 'partial' | 'total';
  minX: number; minY: number; maxX: number; maxY: number;
}

export type DiagramShape = DiagramShapeObject;
export type ConnectorShape = ConnectorShapeObject;

