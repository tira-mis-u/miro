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
  | 'annotation' | 'table' | 'column' | 'keyMarker' | 'junction' | 'waypoint'
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
  | 'uml-assembly' | 'uml-sequence-message' | 'uml-create-message' | 'uml-state-transition' | 'uml-activity-flow'
  | 'erd-relationship' | 'bpmn-sequence-flow' | 'bpmn-message-flow' | 'bpmn-association' | 'bpmn-data-association';
export type Solid3DFamily = 'box' | 'revolved' | 'pyramid' | 'prism' | 'polyhedron';
export type ShapeParameterValue = number | string | boolean;
export type ShapeParameterStatus = 'user-editable' | 'internal' | 'derived' | 'legacy';
export type ShapeDataCapability = 'classifier' | 'table' | 'column';

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
export interface ShapeSemanticMetadata {
  readonly notation: 'uml' | 'erd' | 'bpmn' | 'flow' | '3d';
  readonly family: string;
  readonly role: string;
  /** Stable reusable groups used by connector rules, not shape-id conditionals. */
  readonly connectionGroups?: readonly string[];
  /** A true logical parent relationship; this is distinct from a dashed/visual group outline. */
  readonly container?: { readonly accepts: readonly string[] };
}

export type EndpointSide = 'source' | 'target';

export type EndpointMarker =
  | 'none' | 'arrow' | 'openArrow' | 'blockArrow' | 'hollowTriangle'
  | 'diamond' | 'filledDiamond' | 'circle' | 'bar' | 'crowFoot'
  | 'zeroOrOne' | 'oneOrMany' | 'zeroOrMany';
export type Cardinality = 'one' | 'zero-or-one' | 'many' | 'one-or-many' | 'zero-or-many';

/** Common resize behavior for definitions whose dimensions have a stable relationship. */
export type ShapeResizePolicy =
  | { readonly mode: 'free' }
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

export interface DiagramData {
  [key: string]: unknown;
}

export interface ShapeConnectionPoint {
  id: 'top' | 'right' | 'bottom' | 'left' | 'center' | string;
  x: number;
  y: number;
}

export interface ShapeEndpointReference {
  shapeId: string;
  pointId: string;
}

export interface DiagramShapeObject {
  id: string;
  type: 'diagram';
  shapeId: string;
  x: number; y: number; w: number; h: number;
  rotation: number;
  fill: string; stroke: string; sw: number;
  text?: string; fs?: number; textColor?: string;
  params: Record<string, unknown>;
  /** Independent local X/Y/Z dimension factors applied to 3D vertices before XYZ rotation; omitted on legacy records. */
  scale3d?: { x: number; y: number; z: number };
  /** Versioned 3D local-pose migration marker; omitted by legacy records. */
  solid3dPoseVersion?: number;
  data?: DiagramData;
  /** Stable semantic ownership edge for nested UML/BPMN containers. */
  containerId?: string;
  minX: number; minY: number; maxX: number; maxY: number;
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
  sourceRef?: ShapeEndpointReference; targetRef?: ShapeEndpointReference;
  label?: string;
  minX: number; minY: number; maxX: number; maxY: number;
}
