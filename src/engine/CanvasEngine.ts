import { getStroke } from 'perfect-freehand';
import * as Y from 'yjs';
import RBush from 'rbush';
import { parseTelex } from '../formula/parser';
import { renderFormulaToHTML } from '../formula/renderer';
import { CODE_LANGUAGES, DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage, type CodeLanguage } from '../code/languages';
import { CanvasCodePreviewCache } from '../code/canvasHighlight';
import { initialCodeBlockHeight } from '../code/layout';
import { recognizeSmartDrawing } from './smartDrawing';
import { getShapeDefinition, getShapeDefinitionByToolId, getShapeDefinitionForLegacyType, getShapeResizePolicy, getVisibleShapeDefinitionByToolId } from './shapes/registry';
import type { RegisteredBoxShapeToolId, RegisteredConnectorToolId, RegisteredShapeToolId } from './shapes/registry';
import { buildGeometryCommands, buildShapeGeometry, drawPathCommands, geometryUsesFill, structuredTableLayout, SEQUENCE_ACTOR_GLYPH_HEIGHT, SEQUENCE_ACTOR_HEADER_HEIGHT, SEQUENCE_LIFELINE_HEADER_HEIGHT, SEQUENCE_ROLE_HEADER_HEIGHT, sequenceParticipantHeaderHeight, UML_BOUNDARY_TITLE_HEIGHT } from './shapes/geometry';
import { buildConnectorRoute, CONNECTOR_LABEL_HEIGHT, connectorDisplayLabel, connectorLabelLayout, connectorLabelPlacementAtPoint, fitConnectorLabel, parallelConnectorLabelOffset, UML_RELATIONSHIP_LANE_SPACING, UML_SEQUENCE_LANE_SPACING } from './shapes/connectors';
import { containerAcceptsSemanticChild, connectorEndpointPairAllowed, connectorEndpointSideAllowed } from './shapes/semantics';
import { contextForConnector, contextForDefinition, diagnoseUmlGraph, diagramCapabilitiesFor, inferUmlContexts, UML_FOUNDATION_SCHEMA_VERSION, type DiagramGraphDiagnostic } from './shapes/diagramContext';
import { diagramTypography } from './shapes/typography';
import {
  addClassifierMemberToModel,
  addInstanceValueToModel,
  classifierKindForShape,
  classifierLayout,
  hitTestClassifier,
  hitTestInstance,
  instanceLayout,
  normalizeUmlStructuredData,
  parseClassifierMemberText,
  parseInstanceValueText,
  removeClassifierMemberFromModel,
  removeInstanceValueFromModel,
  updateClassifierMemberInModel,
  updateInstanceValueInModel,
  type ClassifierHitResult,
  type UMLClassifierCompartmentKind,
} from './shapes/classifier';
import { normalizeShapeParameterPatch } from './shapes/parameters';
import { ActivityPolicy } from './shapes/activityPolicy';
import { StatePolicy } from './shapes/statePolicy';
import { normalizeActivityFlowData, normalizeBehavioralDiagramData, UML_STATE_FIRST_REGION_ID, UML_STATE_ROOT_REGION_ID } from './shapes/behavioralData';
import { compareSequenceEvents, createSequenceMessageEvent, isSequenceMessageShape, normalizeSequenceDiagramData,
  sequenceMessageKindForShape } from './shapes/sequence';
import { normalizeExtendRelationshipData, normalizeUseCaseDiagramData } from './shapes/usecaseData';
import { buildSolid3DProjection, normalizeSolid3DScale, projectSolid3DAxes, projectSolid3DVector, rotateSolid3DOrientationAboutLocalAxis, solid3DCameraDepth, solid3DLocalAxisSpans, solid3DScaleFromBounds, solid3DSizeGroup, solid3DRotationFrames, SOLID3D_CANVAS_INITIAL_YAW_DEGREES, SOLID3D_POSE_VERSION, type Solid3DGeometry, type Solid3DRotationAxis, type Solid3DScale } from './shapes/solid3d';
import { connectionPointById, connectionPointsAtSequenceTime, connectionPointsForBox, connectorBounds, deserializeBoardShape, deriveStructuredShapeParameters, isDoubleClickTextEditableShape, normalizeDragBox, objectPointToWorld, persistentSequencePointId, resizeBoxFromHandle, resizeDiagramEmbeddedTextScale, rotatedBoxBounds, rotatedBoxCorners, rotatePoint, unrotatePoint, worldPointToObject } from './shapes/model';
import type { BehavioralNodeRole, Cardinality, ConnectorShapeObject, DiagramShapeObject, EndpointIntent, EndpointMarker, EndpointSide, PathCommand, SequenceActivationData, SequenceFragmentData, SequenceLifecycleData, SequenceMessageEventData, SequenceParticipantData, ShapeConnectionPoint, ShapeDefinition, ShapeResizePolicy, TableColumnModel, UMLActivityNodeData, UMLClassifierData, UMLDiagramFamily, UMLInstanceData, UMLStatePointData, UMLStateVertexData, UMLUseCaseData } from './shapes/types';

export type ToolType =
  | 'select' | 'lasso-select' | 'pen' | 'eraser'
  | 'sticky' | 'text' | 'math' | 'code' | 'image'
  | RegisteredShapeToolId;

export type BoxShapeTool = RegisteredBoxShapeToolId;
export type ConnectorTool = RegisteredConnectorToolId;

export interface Camera { x: number; y: number; zoom: number; }

interface BaseShape { id:string; type:string; minX:number; minY:number; maxX:number; maxY:number; }
interface BoxShape extends BaseShape {
  x:number; y:number; w:number; h:number;
  rotation?: number;
  shapeId?: string;
  params?: Record<string, unknown>;
  data?: Record<string, unknown>;
  text?: string; fs?: number; textColor?: string;
  /** Persisted only on owned legacy boxes that share the registered diagram label renderer. */
  embeddedTextScale?: number;
  vertices?: [number, number][];
}

export interface PenShape     extends BaseShape { type:'pen';      pts:number[][]; color:string; size:number; /** New ink defines pressure simulation explicitly; absent on legacy saved strokes. */ simulatePressure?: boolean; }
export interface LineShape    extends BaseShape { type:'line'; x1:number; y1:number; x2:number; y2:number; color:string; sw:number; }
export interface CurveShape   extends BaseShape { type:'curve'; pts:number[][]; color:string; sw:number; }
export interface RectShape    extends BoxShape  { type:'rect'|'rounded-rect'; fill:string; stroke:string; sw:number; }
export interface EllipseShape extends BoxShape  { type:'ellipse';  fill:string; stroke:string; sw:number; }
export interface TriShape     extends BoxShape  { type:'triangle'; fill:string; stroke:string; sw:number; vertices?: [number, number][]; }
export interface DiamShape    extends BoxShape  { type:'diamond';  fill:string; stroke:string; sw:number; }
export interface StarShape    extends BoxShape  { type:'star';     fill:string; stroke:string; sw:number; }
export interface CalloutShape extends BoxShape  { type:'callout'; fill:string; stroke:string; sw:number; }
export interface PolygonShape extends BoxShape { type:'pentagon'|'hexagon'|'parallelogram'|'trapezoid'|'right-triangle'; fill:string; stroke:string; sw:number; }
export interface ArrowShape   extends BaseShape { type:'arrow';    x1:number;y1:number;x2:number;y2:number; color:string; sw:number; }
export interface StickyShape  extends BoxShape  { type:'sticky';   text:string; bg:string; fs:number; createdAt?: string; }
export interface TextShape    extends BoxShape  { type:'text'|'math'|'code'; text:string; color:string; fs:number; language?: CodeLanguage; previewText?: string; autoHeight?: boolean; }
export interface ImageShape   extends BoxShape  { type:'image';    src:string; naturalW:number; naturalH:number; }
export interface VideoShape   extends BoxShape  { type:'video';    src:string; title?: string; }
export interface LinkCardShape extends BoxShape {
  type: 'link-card';
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
  mediaType?: 'website' | 'video' | 'article' | 'image';
  embedUrl?: string;
  status?: 'loading' | 'ready' | 'error';
}
export type DiagramShape = DiagramShapeObject;
export type ConnectorShape = ConnectorShapeObject;
export type AnyShape = PenShape|LineShape|CurveShape|RectShape|EllipseShape|TriShape|DiamShape|StarShape|CalloutShape|PolygonShape|ArrowShape|StickyShape|TextShape|ImageShape|VideoShape|LinkCardShape|DiagramShape|ConnectorShape;
type RotatableShape = Exclude<AnyShape, PenShape | LineShape | CurveShape | ArrowShape | ConnectorShape>;

export interface StyleOptions {
  penColor:string; penSize:number;
  fill:string; stroke:string; sw:number;
  stickyBg:string; fontSize:number;
}

export interface ShapeStylePatch {
  fill?: string;
  stroke?: string;
  sw?: number;
  color?: string;
  bg?: string;
  size?: number;
  fs?: number;
  textColor?: string;
}

// ── cursor types for each resize handle ──────────────────────────────────────
const HANDLE_CURSORS: Record<string,string> = {
  nw:'nw-resize', ne:'ne-resize', sw:'sw-resize', se:'se-resize',
  n:'n-resize',   s:'s-resize',   e:'e-resize',   w:'w-resize',
  'line-start':'crosshair', 'line-end':'crosshair', rotate:'grab', waypoint:'move', 'label-position':'move',
  'source-label-position':'move', 'target-label-position':'move',
};
const ERASER_RADIUS_PX = 11;
const MAX_PEN_STROKE_WIDTH = 50;
interface CachedDiagramGeometry {
  key: string; path?: Path2D; outline: PathCommand[]; decorations: PathCommand[][]; decorationStyles: Array<'solid' | 'dashed' | 'dotted' | undefined>;
  intrinsicFills: PathCommand[][]; intrinsicFillColors: Array<'outline' | 'surface'>; hiddenEdges: PathCommand[][];
  visibleFaces: import('./shapes/solid3d').Solid3DProjection['visibleFaces']; projection?: import('./shapes/solid3d').Solid3DProjection['metadata'];
  decorationPaths?: Array<Path2D | undefined>; intrinsicFillPaths?: Array<Path2D | undefined>; hiddenEdgePaths?: Array<Path2D | undefined>; visibleFacePaths?: Array<Path2D | undefined>;
}
type ConnectorLabelKind = 'center' | 'source' | 'target' | 'source-multiplicity' | 'target-multiplicity';
interface ConnectorLabelVisual {
  kind: ConnectorLabelKind;
  editable: boolean;
  positionEditable: boolean;
  text: string; x: number; y: number; width: number; height: number; textWidth: number; fontSize: number;
}
type SolidTransformMode = 'size' | 'rotate';
interface SolidAxisControl {
  axis: Solid3DRotationAxis;
  label: 'X' | 'Y' | 'Z';
  color: string;
  direction: [number, number, number];
  planeU: [number, number, number];
  planeV: [number, number, number];
  cameraDepth: number;
  /** Screen-space local-axis direction and the true projected dimension derivative. */
  directionClient: [number, number];
  sizeHandleClient: [number, number];
  sizeHandleNegativeClient: [number, number];
  sizeLabelClient: [number, number];
  sizeBasisClient: [number, number];
  /** Projected local rotation ring, generated around the same center pivot. */
  planeUClient: [number, number];
  planeVClient: [number, number];
  ringPointsClient: [number, number][];
  ringFront: boolean[];
  ringLabelClient: [number, number];
  ringAngle: number;
  ringRadiusCss: number;
}
interface SolidTransformBasis {
  id: string;
  pivotWorld: [number, number];
  pivotClient: [number, number];
  axes: Record<Solid3DRotationAxis, SolidAxisControl>;
  sizeEnabled: boolean;
  rotateEnabled: boolean;
  modeControlClient: { x: number; y: number; width: number; height: number };
  frameClient: { minX: number; minY: number; maxX: number; maxY: number };
}
interface ActiveSolidTransform {
  id: string;
  mode: SolidTransformMode;
  axis: Solid3DRotationAxis;
  original: DiagramShape;
  startClient: [number, number];
  pivotClient: [number, number];
  sizeBasisClient: [number, number];
  sizeGroup: Array<'x' | 'y' | 'z'>;
  sizeDirectionSign: 1 | -1;
  planeUClient: [number, number];
  planeVClient: [number, number];
  degeneratePlane: boolean;
  previousAngle: number;
  totalAngle: number;
}
interface ResizeRef { wx: number; wy: number; s: AnyShape; }
interface ConnectorTargetFeedback { shapeId: string; point: { x: number; y: number }; valid: boolean; }
type PositionedShape = Extract<AnyShape, { x: number; y: number; w: number; h: number }>;
type DomOverlayShape = StickyShape | TextShape | ImageShape | VideoShape | LinkCardShape;

type LegacyBoxToolType = 'rect' | 'rounded-rect' | 'ellipse' | 'triangle' | 'right-triangle' | 'diamond'
  | 'parallelogram' | 'trapezoid' | 'pentagon' | 'hexagon' | 'star';

interface SolidCreationGesture {
  readonly state: 'CREATING_3D_SHAPE';
  readonly id: string;
  readonly shapeId: string;
  readonly anchorWorld: readonly [number, number];
  readonly pointerDownClient: readonly [number, number];
  readonly pointerDownCanvas: readonly [number, number];
  readonly initialScale: Readonly<Solid3DScale>;
  readonly referenceLength: number;
  readonly definitionWidth: number;
  readonly definitionHeight: number;
}
type SolidTransformHit =
  | { id: string; kind: 'mode'; mode: SolidTransformMode; distance: number }
  | { id: string; kind: 'axis'; mode: SolidTransformMode; axis: Solid3DRotationAxis; distance: number; directionSign?: 1 | -1 };
const SOLID_GIZMO_COLORS: Readonly<Record<Solid3DRotationAxis, string>> = Object.freeze({
  rotationX: '#b94b51', rotationY: '#3b8a68', rotationZ: '#3f72b8',
});
const SOLID_AXIS_KEYS: Readonly<Record<Solid3DRotationAxis, 0 | 1 | 2>> = Object.freeze({
  rotationX: 0, rotationY: 1, rotationZ: 2,
});
const SOLID_AXIS_NAMES: Readonly<Record<Solid3DRotationAxis, 'x' | 'y' | 'z'>> = Object.freeze({
  rotationX: 'x', rotationY: 'y', rotationZ: 'z',
});
const SOLID_SIZE_TOGGLE_WIDTH = 48;
const SOLID_TOGGLE_GAP = 4;
const SOLID_ROTATE_TOGGLE_WIDTH = 60;
const SOLID_TOGGLE_WIDTH = SOLID_SIZE_TOGGLE_WIDTH + SOLID_TOGGLE_GAP + SOLID_ROTATE_TOGGLE_WIDTH;
const SOLID_SIZE_HIT_RADIUS = 11;
const SOLID_SIZE_SHAFT_HIT_RADIUS = 6.5;
const SOLID_SIZE_SHAFT_CORE_GAP = 14;
const SOLID_ROTATE_ARC_HIT_RADIUS = 6.5;
const SOLID_ROTATE_LABEL_HIT_RADIUS = 12;
const SOLID_HIT_AMBIGUITY_DISTANCE = 1.25;
export class CanvasEngine {
  private cv: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  private yMap: Y.Map<AnyShape>;
  private shapes: Map<string,AnyShape> = new Map();
  private opaqueShapes = new Map<string, unknown>();
  private geometryCache = new WeakMap<object, CachedDiagramGeometry>();
  private rtree = new RBush<AnyShape>();

  public  cam: Camera = { x:0, y:0, zoom:1 };
  public  tool: ToolType = 'pen';
  private previousCreationTool: ToolType | null = null;
  public  penMode: 'normal' | 'smart' = 'normal';
  private diagramContext: UMLDiagramFamily | null = null;
  private graphNotifyQueued = false;
  /** Incremental endpoint/ownership indexes keep drag and resize gestures local. */
  private connectorIdsByEndpoint = new Map<string, Set<string>>();
  private ownedIdsByContainer = new Map<string, Set<string>>();
  private nextParallelOrder = 1;
  public  style: StyleOptions = {
    penColor:'#1e293b', penSize:6,
    fill:'transparent', stroke:'#1e40af', sw:2,
    stickyBg:'#fef08a', fontSize:14,
  };

  public onShapeUpdate: ((s: AnyShape) => void) | null = null;
  public onGraphUpdate: ((diagnostics: DiagramGraphDiagnostic[]) => void) | null = null;

  private editingId: string | null = null;
  public setEditingId(id: string | null) {
    this.editingId = id;
    if (id === null) {
      this.editingClassifierContext = null;
    }
    this.dirty = true;
  }

  private editingClassifierContext: {
    shapeId: string;
    target: 'header' | 'member' | 'empty-compartment' | 'usecase-ext' | 'er-title' | 'er-column';
    memberId?: string;
    columnIndex?: number;
  } | null = null;
  public setEditingClassifierContext(context: typeof this.editingClassifierContext) {
    this.editingClassifierContext = context;
    this.dirty = true;
  }

  private raf = 0;
  private dirty = true;
  private imgCache = new Map<string,HTMLImageElement>();

  // overlay for dom elements
  private overlayDiv: HTMLDivElement;
  private wrapperDiv: HTMLDivElement;
  private overlayAttachTimer: ReturnType<typeof setTimeout> | null = null;
  private lastOverlayState = '';
  private codePreviewCache = new CanvasCodePreviewCache();
  private destroyed = false;

  // interaction state
  private isDown    = false;
  private isPanning = false;
  private panButton: number | null = null;
  private isErasing = false;
  private eraseChanged = false;
  private eraserLastPoint: { x: number; y: number } | null = null;
  private eraserCursorPoint: { x: number; y: number } | null = null;
  private activeSmartDrawing = false;
  private activePointerId: number | null = null;
  private pendingPenPublishRaf: number | null = null;
  private currId: string|null = null;
  private panRef    = {sx:0,sy:0,cx:0,cy:0};
  private shapeOrigin = {x:0,y:0};
  /** Explicit 3D CREATE gesture, independent from generic MOVE/RESIZE and gizmo state. */
  private solidCreationGesture: SolidCreationGesture | null = null;

  // select / drag / resize / box
  public  sel           = new Set<string>();
  private isDragging    = false;
  private dragRef       = {wx:0,wy:0};
  private dragOrigins   = new Map<string,{x:number,y:number}>();
  private dragShapeOrigins = new Map<string, AnyShape>();
  private isResizing    = false;
  private isSizing3D    = false;
  private isRotating3D  = false;
  private solidTransformGesture: ActiveSolidTransform | null = null;
  /** Transient canvas UI preferences: independent layers, intentionally absent from shape data. */
  /** Single mode source makes SIZE/ROTATE mutually exclusive by construction. */
  private solidTransformMode: SolidTransformMode | null = 'size';
  private get solidSizeEnabled() { return this.solidTransformMode === 'size'; }
  private set solidSizeEnabled(enabled: boolean) {
    if (enabled) this.solidTransformMode = 'size';
    else if (this.solidTransformMode === 'size') this.solidTransformMode = null;
  }
  private get solidRotateEnabled() { return this.solidTransformMode === 'rotate'; }
  private set solidRotateEnabled(enabled: boolean) {
    if (enabled) this.solidTransformMode = 'rotate';
    else if (this.solidTransformMode === 'rotate') this.solidTransformMode = null;
  }
  private hoveredSolidControl: SolidTransformHit | null = null;
  private resizeH       = '';
  private resizeRef: ResizeRef | null = null;
  private isBoxing      = false;
  private boxA          = {x:0,y:0};
  private boxB          = {x:0,y:0};
  private isLassoing    = false;
  private lassoPts: {x:number,y:number}[] = [];
  private connectorTargetFeedback: ConnectorTargetFeedback | null = null;
  private connectorSourceFeedback: ConnectorTargetFeedback | null = null;

  // callbacks
  public onSel?:      (ids:string[]) => void;
  public onZoom?:     (z:number) => void;
  public onCam?:      (cam:Camera) => void;
  public onCameraChange: ((cam: Camera) => void) | null = null;
  public onContextMenu?: (x:number, y:number) => void;
  public onTextEdit?: (s:AnyShape) => void;
  public onEditText?: (s: AnyShape, cx: number, cy: number) => void;
  public onEditSemantic?: (s: AnyShape) => void;
  public onCursor?:   (cursor:string) => void;
  public onTool?:     (tool:ToolType) => void;
  public isReadOnly: boolean = false;

  // Dedicated high-frequency render-frame camera listeners (decoupled from React state updates)
  private cameraFrameListeners = new Set<(cam: Camera) => void>();

  public addCameraFrameListener(cb: (cam: Camera) => void): () => void {
    this.cameraFrameListeners.add(cb);
    return () => {
      this.cameraFrameListeners.delete(cb);
    };
  }

  private notifyCameraFrame() {
    for (const cb of this.cameraFrameListeners) {
      try { cb(this.cam); } catch (e) { console.error('Camera frame listener error:', e); }
    }
  }

  private undoManager!: Y.UndoManager;
  private readonly loadMigrationOrigin = { source: 'uml-foundation-load-migration' };
  private readonly remoteRepairOrigin = { source: 'canvas-engine-remote-repair' };
  private readonly remoteDeletedKeys = new Set<string>();
  private pendingFormulaCaptureId: string | null = null;

  private readonly onYMapChange = (event: Y.YMapEvent<AnyShape>) => {
    const origin = event.transaction.origin;
    if (origin === this) {
      // A subsequent local add/update supersedes any older observed remote tombstone.
      event.changes.keys.forEach((change, key) => {
        if (change.action !== 'delete') this.remoteDeletedKeys.delete(key);
      });
      return;
    }
    const externalChange = origin !== this.remoteRepairOrigin && origin !== this.undoManager
      && !this.undoManager.undoing && !this.undoManager.redoing;
    let redraw = false;
    let selectionChanged = false;
    event.changes.keys.forEach((change, key) => {
      if (externalChange) {
        if (change.action === 'delete') this.remoteDeletedKeys.add(key);
        else this.remoteDeletedKeys.delete(key);
      }
      const old = this.shapes.get(key);
      if (old) this.rtree.remove(old);
      if (change.action === 'delete') {
        // A remote deletion needs a deterministic detached edge, but that repair is not a local user edit.
        // Undo/redo already contains the connector-reference change in the same local history item.
        if (old && isConnectableShape(old) && !this.undoManager.undoing && !this.undoManager.redoing) {
          this.detachConnectorsFrom(key, this.remoteRepairOrigin);
        }
        if (old?.type === 'diagram' && externalChange) this.detachContainedChildrenFrom(key, this.remoteRepairOrigin);
        if (old) this.removeShapeIndexes(old);
        if (old?.type === 'code') this.codePreviewCache.forget(key);
        this.shapes.delete(key);
        this.opaqueShapes.delete(key);
        selectionChanged = this.sel.delete(key) || selectionChanged;
      } else {
        const raw = this.yMap.get(key);
        const shape = deserializeBoardShape(key, raw);
        if (!shape) {
          if (old) this.removeShapeIndexes(old);
          this.shapes.delete(key);
          this.opaqueShapes.set(key, raw);
          if (old?.type === 'code') this.codePreviewCache.forget(key);
          selectionChanged = this.sel.delete(key) || selectionChanged;
        } else {
          const typedShape = shape as unknown as AnyShape;
          this.opaqueShapes.delete(key);
          if (old) this.removeShapeIndexes(old);
          if (old?.type === 'code' && typedShape.type !== 'code') this.codePreviewCache.forget(key);
          this.shapes.set(key, typedShape);
          this.rtree.insert(typedShape);
          this.addShapeIndexes(typedShape);
          if (externalChange && isConnectableShape(typedShape)) this.updateAttachedConnectors(key, this.remoteRepairOrigin);
          // Undo/redo and remote Yjs writes bypass put(); keep the selected properties panel
          // synchronized with the map value just as local engine writes do.
          if (this.sel.has(key)) this.onShapeUpdate?.(typedShape);
        }
      }
      if (key !== this.editingId) redraw = true;
    });
    if (selectionChanged) this.onSel?.([...this.sel]);
    if (redraw) this.dirty = true;
    if (externalChange) this.queueGraphDiagnostics();
  };

  constructor(cv: HTMLCanvasElement, yMap: Y.Map<AnyShape>) {
    this.cv   = cv;
    this.cx   = cv.getContext('2d', {alpha:false})!;
    this.yMap = yMap;
    this.undoManager = new Y.UndoManager(this.yMap, {
      trackedOrigins: new Set([this]),
      // Engine operations are grouped explicitly at saveH() boundaries, not by wall-clock timing.
      captureTimeout: Number.POSITIVE_INFINITY,
      // Preserve map-key concurrency: remote writes must not be selectively erased by local undo.
      ignoreRemoteMapChanges: false,
    });

    this.yMap.forEach((raw:unknown, key:string) => {
      const shape = deserializeBoardShape(key, raw);
      if (!shape) { this.opaqueShapes.set(key, raw); return; }
      const typedShape = shape as unknown as AnyShape;
      this.shapes.set(key, typedShape);
      this.rtree.insert(typedShape);
      this.addShapeIndexes(typedShape);
    });
    for (const shape of this.shapes.values())
      if (shape.type === 'connector' && Number.isFinite((shape as ConnectorShape).parallelOrder))
        this.nextParallelOrder = Math.max(this.nextParallelOrder, Math.floor((shape as ConnectorShape).parallelOrder!) + 1);
    this.migrateLoadedUmlRecords();

    // Setup overlay DOM for Math/Code
    this.overlayDiv = document.createElement('div');
    this.overlayDiv.style.position = 'absolute';
    this.overlayDiv.style.inset = '0';
    this.overlayDiv.style.pointerEvents = 'none';
    this.overlayDiv.style.overflow = 'hidden';
    this.overlayDiv.style.zIndex = '10';
    
    this.wrapperDiv = document.createElement('div');
    this.wrapperDiv.style.transformOrigin = '0 0';
    this.overlayDiv.appendChild(this.wrapperDiv);
    
    // Wait for the canvas to be attached; cleanup cancels this on React/StrictMode remounts.
    this.overlayAttachTimer = setTimeout(() => {
      this.overlayAttachTimer = null;
      if (!this.destroyed && this.cv.parentElement) this.cv.parentElement.appendChild(this.overlayDiv);
    }, 100);

    this.yMap.observe(this.onYMapChange);

    this.saveH();
    this.loop();
  }

  // ─── coordinate conversion ──────────────────────────────────────────────
  // Keep pointer, zoom and DOM-overlay conversions in canvas backing-pixel space.
  // The canvas currently uses CSS-pixel backing dimensions (no DPR multiplier), but
  // the measured ratios also cover fractional CSS sizes and any future DPR backing.
  private clientToCanvas(clientX: number, clientY: number) {
    const rect = this.cv.getBoundingClientRect();
    const scaleX = rect.width > 0 ? this.cv.width / rect.width : 1;
    const scaleY = rect.height > 0 ? this.cv.height / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  private canvasToClient(x: number, y: number) {
    const rect = this.cv.getBoundingClientRect();
    const scaleX = this.cv.width > 0 ? rect.width / this.cv.width : 1;
    const scaleY = this.cv.height > 0 ? rect.height / this.cv.height : 1;
    return {
      x: rect.left + x * scaleX,
      y: rect.top + y * scaleY,
    };
  }

  /** Canvas backing-pixel coordinates to board world coordinates through the camera only. */
  canvasToWorld(canvasX: number, canvasY: number) {
    return {
      x: (canvasX - this.cv.width / 2) / this.cam.zoom + this.cam.x,
      y: (canvasY - this.cv.height / 2) / this.cam.zoom + this.cam.y,
    };
  }

  /** Board world coordinates to canvas backing pixels through the camera only. */
  worldToCanvas(worldX: number, worldY: number) {
    return {
      x: (worldX - this.cam.x) * this.cam.zoom + this.cv.width / 2,
      y: (worldY - this.cam.y) * this.cam.zoom + this.cv.height / 2,
    };
  }

  // clientX/Y → world coords through CSS/client scaling followed by the camera transform.
  clientToWorld(clientX: number, clientY: number) {
    const pixel = this.clientToCanvas(clientX, clientY);
    return this.canvasToWorld(pixel.x, pixel.y);
  }

  // world → CSS/client screen coordinates (used by DOM overlays and pointer test tooling).
  worldToClient(worldX: number, worldY: number) {
    const pixel = this.worldToCanvas(worldX, worldY);
    return this.canvasToClient(pixel.x, pixel.y);
  }

  // world → CSS coordinates relative to an overlay container element inside the canvas workspace.
  // Directly projects through the camera transform, scales backing buffer coordinates to display CSS pixels,
  // and compensates for any origin offset between canvas and overlay.
  worldToOverlay(worldX: number, worldY: number, overlayElement?: HTMLElement | null): { x: number; y: number } {
    const pixel = this.worldToCanvas(worldX, worldY);
    const cvRect = this.cv.getBoundingClientRect();
    const scaleX = this.cv.width > 0 ? cvRect.width / this.cv.width : 1;
    const scaleY = this.cv.height > 0 ? cvRect.height / this.cv.height : 1;

    let originOffsetX = 0;
    let originOffsetY = 0;
    if (overlayElement) {
      const oRect = overlayElement.getBoundingClientRect();
      originOffsetX = cvRect.left - oRect.left;
      originOffsetY = cvRect.top - oRect.top;
    }

    return {
      x: pixel.x * scaleX + originOffsetX,
      y: pixel.y * scaleY + originOffsetY,
    };
  }

  /**
   * Returns true only when a continuous drawing/creation gesture is actively in progress.
   * Explicitly excludes selection dragging, shape resizing, box selection, lasso, and panning.
   */
  public isDrawingActive(): boolean {
    if (!this.isDown) return false;
    if (this.tool === 'pen' && this.currId !== null) return true;
    if (this.currId !== null && (isBoxShapeTool(this.tool) || isConnectorTool(this.tool))) return true;
    if (this.solidCreationGesture !== null) return true;
    return false;
  }

  // ─── pointer events (called with raw DOM events from window listener) ───
  pointerDown(e: PointerEvent) {
    if (e.target && (e.target as HTMLElement).closest('.formula-editor-panel, .popover, .math-tools-panel, .no-canvas, .zoom-controls, .panel-ui, .toolbar, .code-editor-shell')) return;
    // A second pointer must not replace the in-flight gesture or its pointer identity.
    if (this.isDown || this.isPanning || this.isErasing || this.isDragging || this.isResizing || this.isSizing3D || this.isRotating3D || this.isBoxing || this.isLassoing) return;
    if (e.isPrimary === false) return;
    if (e.button === 2 || e.button === 1) {
      e.preventDefault();
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.isPanning = true;
      this.panButton = e.button;
      const pointer = this.clientToCanvas(e.clientX, e.clientY);
      this.panRef = { sx: pointer.x, sy: pointer.y, cx: this.cam.x, cy: this.cam.y };
      this.onCursor?.('grabbing');
      return;
    }
    if (e.button !== 0) return;

    if (this.isReadOnly) {
      e.preventDefault();
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.isPanning = true;
      this.panButton = e.button;
      const pointer = this.clientToCanvas(e.clientX, e.clientY);
      this.panRef = { sx: pointer.x, sy: pointer.y, cx: this.cam.x, cy: this.cam.y };
      this.onCursor?.('grabbing');
      return;
    }

    const w = this.clientToWorld(e.clientX, e.clientY);

    if (this.tool === 'eraser') {
      this.isDown = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.isErasing = true;
      this.eraseChanged = false;
      this.eraserCursorPoint = w;
      this.eraserLastPoint = w;
      this.eraseAlongSegment(w, w);
      this.dirty = true;
      return;
    }

    // --- 0. Independent solid SIZE/ROTATE toggles and active local-axis controls ---
    // A just-created solid remains selected even while its creation tool is active.
    // Keep its visible canvas controls interactive in that state as well; the hit test
    // itself is scoped to the single selected registered 3D solid.
    const solidControlHit = this.hitSolidTransformControl(e.clientX, e.clientY);
    if (solidControlHit) {
      e.preventDefault();
      this.beginSolidTransform(solidControlHit, e);
      return;
    }

    // Ordinary 2D handles remain unchanged; solid3D shapes are deliberately excluded.
    const rh = this.hitResizeHandle(e.clientX, e.clientY);
    if (rh) {
      e.preventDefault();
      this.isResizing = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.resizeH = rh.h;
      const s = this.shapes.get(rh.id)!;
      this.resizeRef = { wx: w.x, wy: w.y, s: structuredClone(s) };
      this.onCursor?.(HANDLE_CURSORS[rh.h] ?? 'nwse-resize');
      return;
    }

    // Lasso remains a deliberate gesture; resize handles have already claimed their exact hit
    // regions above, so dragging elsewhere still starts a lasso.
    if (this.tool === 'lasso-select') {
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.isLassoing = true;
      this.lassoPts = [w];
      if (!e.shiftKey) { this.sel.clear(); this.onSel?.([]); }
      this.onCursor?.('crosshair');
      this.dirty = true;
      return;
    }

    // If an object is actively being edited, clicking empty board keeps it selected and returns to select tool
    if (this.editingId) {
      const activeEditingId = this.editingId;
      const rawHit = this.hitShape(w.x, w.y);
      if (!rawHit) {
        this.sel.clear();
        this.sel.add(activeEditingId);
        this.onSel?.([activeEditingId]);
        if (this.tool !== 'select') {
          if (!this.previousCreationTool) this.previousCreationTool = this.tool;
          this.tool = 'select';
          this.onTool?.('select');
        }
        this.dirty = true;
        return;
      }
    }

    // --- 1. HIT TEST for existing objects ---
    let hit: AnyShape | null = null;

    // Prioritize selected shapes: clicking on/inside an already selected shape's bounds
    // always interacts with / drags it, and NEVER draws a new shape over it!
    if (this.sel.size > 0 && this.tool !== 'pen') {
      for (const id of this.sel) {
        const s = this.shapes.get(id);
        if (s && 'minX' in s && 'maxX' in s && 'minY' in s && 'maxY' in s) {
          const tol = 8 / this.cam.zoom;
          if (w.x >= s.minX - tol && w.x <= s.maxX + tol && w.y >= s.minY - tol && w.y <= s.maxY + tol) {
            hit = s;
            break;
          }
        }
      }
    }

    if (!hit) {
      const rawHit = this.hitShape(w.x, w.y);
      if (rawHit) {
        if (this.tool === 'select') {
          hit = rawHit;
        } else if (this.sel.has(rawHit.id)) {
          hit = rawHit;
        } else if (isTextTool(this.tool)) {
          if (isTextTool(rawHit.type)) hit = rawHit;
        } else if (this.tool === 'sticky') {
          if (rawHit.type === 'sticky') hit = rawHit;
        } else if (isConnectorTool(this.tool)) {
          if (isConnectorShape(rawHit) || !isConnectableShape(rawHit)) {
            hit = rawHit;
          } else {
            const definition = getShapeDefinitionByToolId(this.tool);
            const nearbyCandidates = definition
              ? this.connectionPointCandidates(w.x, w.y, 'preview', definition, 'source', { includeIncompatible: true, maxDistance: 24 / this.cam.zoom })
              : [];
            if (nearbyCandidates.length === 0) {
              hit = rawHit;
            }
          }
        } else if (isBoxShapeTool(this.tool)) {
          const childDefinition = getVisibleShapeDefinitionByToolId(this.tool);
          const hitDefinition = this.definitionForEndpoint(rawHit);
          const acceptedNestedContainer = childDefinition?.kind === 'shape'
            ? this.findAcceptedContainerAtPoint(childDefinition, w.x, w.y) : undefined;
          const directlyAcceptsChild = rawHit.type === 'diagram' && childDefinition?.kind === 'shape'
            && Boolean(hitDefinition && containerAcceptsSemanticChild(hitDefinition, childDefinition));
          const placesInsideTopContainer = rawHit.type === 'diagram' && Boolean(hitDefinition?.semantic?.container)
            && acceptedNestedContainer !== undefined && acceptedNestedContainer.id !== rawHit.id;
          const placingSemanticChild = directlyAcceptsChild || placesInsideTopContainer;
          if (!placingSemanticChild && (isBoxShapeTool(rawHit.type) || rawHit.type === 'diagram' || isConnectorShape(rawHit))) hit = rawHit;
        } else if (this.tool === 'image') {
          if (rawHit.type === 'image') hit = rawHit;
        }
      }
    }

    if (hit) {
      if (this.tool !== 'select') {
        if (!this.previousCreationTool) this.previousCreationTool = this.tool;
        this.tool = 'select';
        this.onTool?.('select');
      }
      if (!e.shiftKey && !this.sel.has(hit.id)) { this.sel.clear(); }
      this.sel.add(hit.id);
      this.onSel?.([...this.sel]);
      this.isDragging = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.dragRef = {wx:w.x, wy:w.y};
      this.dragOrigins.clear(); this.dragShapeOrigins.clear();
      const captureDragOrigin = (shape: AnyShape) => {
        this.dragOrigins.set(shape.id, getXY(shape));
        this.dragShapeOrigins.set(shape.id, structuredClone(shape));
      };
      this.sel.forEach(id => {
        const shape = this.shapes.get(id);
        if (!shape) return;
        captureDragOrigin(shape);
        if (shape.type === 'diagram') {
          for (const child of this.containedDescendants(id)) captureDragOrigin(child);
          for (const connector of this.containedConnectorDescendants(id)) captureDragOrigin(connector);
        }
      });
      this.onCursor?.('move');
      this.dirty = true;
      return;
    }

    // --- 2. DESELECT IF CLICKING BOARD ---
    if (this.sel.size > 0 && !e.shiftKey) {
      this.clearSelection();
      return;
    }

    // --- 3. TOOL SPECIFIC LOGIC ---

    // ── SELECT tool ──
    if (this.tool === 'select') {
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.isBoxing = true;
      this.boxA = w; this.boxB = w;
      this.onCursor?.('default');
      this.dirty = true;
      return;
    }

    // ── PEN ──
    if (this.tool === 'pen') {
      this.isDown  = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.currId  = uid();
      this.activeSmartDrawing = this.penMode === 'smart';
      const s: PenShape = {
        id:this.currId, type:'pen',
        pts:[[w.x, w.y, this.pressureOf(e, 0.5)]],
        color:this.style.penColor, size:this.style.penSize,
        simulatePressure:false,
        minX:w.x, minY:w.y, maxX:w.x, maxY:w.y,
      };
      this.put(s, {persist: !this.activeSmartDrawing});
      return;
    }

    // ── STICKY / TEXT / MATH / CODE ──
    if (this.tool === 'sticky') {
      const id = uid();
      const x = w.x - 16 / this.cam.zoom;
      const y = w.y - 16 / this.cam.zoom;
      const s: StickyShape = {
        id, type: 'sticky',
        x, y, w: 240, h: 240, fs: 14,
        bg: this.style.stickyBg, text: '',
        createdAt: formatStickyTimestamp(),
        minX:x, minY:y, maxX:x+240, maxY:y+240
      };
      this.put(s);
      this.sel.clear();
      this.sel.add(id); this.onSel?.([id]);
      this.saveH();
      if (!this.previousCreationTool) this.previousCreationTool = this.tool;
      this.tool = 'select';
      this.onTool?.('select');
      setTimeout(() => this.onEditText?.(s, e.clientX, e.clientY), 30);
      return;
    }

    if (isTextTool(this.tool)) {
      const textTool = this.tool;
      const id = uid();
      const offsetX = (textTool === 'code' ? 46 : 16) / this.cam.zoom;
      const offsetY = (textTool === 'code' ? 12 : 16) / this.cam.zoom;
      const nx = w.x - offsetX;
      const ny = w.y - offsetY;
      const codeBlock = textTool === 'code';
      const width = codeBlock ? 360 : 200;
      const height = codeBlock ? initialCodeBlockHeight(this.style.fontSize) : 40;
      const s: TextShape = {
        id, type: textTool, x:nx, y:ny, w:width, h:height,
        text: '',
        color: codeBlock ? '#d4d4d4' : '#000000', fs:this.style.fontSize,
        minX:nx, minY:ny, maxX:nx+width, maxY:ny+height,
        ...(codeBlock ? { language: DEFAULT_CODE_LANGUAGE, autoHeight: true } : {}),
        ...(textTool === 'math' ? { previewText: '' } : {}),
      };
      this.put(s);
      this.sel.clear();
      this.sel.add(id); this.onSel?.([id]);
      this.saveH();
      if (!this.previousCreationTool) this.previousCreationTool = this.tool;
      this.tool = 'select';
      this.onTool?.('select');
      setTimeout(() => this.onEditText?.(s, e.clientX, e.clientY), 30);
      return;
    }

    // ── Registered diagram shapes and connectors ──
    if (isBoxShapeTool(this.tool) || isConnectorTool(this.tool)) {
      this.isDown = true;
      this.activePointerId = Number.isFinite(e.pointerId) ? e.pointerId : null;
      this.currId = uid();
      this.connectorTargetFeedback = null;
      this.connectorSourceFeedback = null;
      this.solidCreationGesture = null;
      this.shapeOrigin = { x: w.x, y: w.y };
      const definition = getVisibleShapeDefinitionByToolId(this.tool);
      if (!definition) { this.isDown = false; this.currId = null; return; }
      if (definition.kind === 'connector') {
        const connector: ConnectorShape = {
          id: this.currId, type: 'connector', shapeId: definition.id,
          x1: w.x, y1: w.y, x2: w.x, y2: w.y, waypoints: [],
          color: definition.defaultStroke ?? (definition.semantic?.notation === 'uml' ? '#0f172a' : this.style.stroke),
          sw: definition.defaultStrokeWidth ?? this.style.sw,
          lineStyle: definition.connector?.lineStyle ?? 'solid',
          startMarker: definition.connector?.startMarker ?? 'none', endMarker: definition.connector?.endMarker ?? 'none',
          ...(definition.connector?.sourceCardinality ? { sourceCardinality: definition.connector.sourceCardinality } : {}),
          ...(definition.connector?.targetCardinality ? { targetCardinality: definition.connector.targetCardinality } : {}),
          ...(definition.defaultLabel !== undefined ? { label: definition.defaultLabel } : {}),
          ...(definition.semantic?.family === 'uml.sequence-edge'
            ? { sequenceTime: Math.round(w.y * 1000) / 1000,
              sequenceEvent: createSequenceMessageEvent(this.currId, `sequence-event:${uid()}`, `sequence-occurrence:${uid()}`,
                sequenceMessageKindForShape(definition.id) ?? 'synchronous', this.sequenceOrderAtVisualY(w.y), Math.round(w.y * 1000) / 1000) } : {}),
          ...(definition.semantic?.family === 'uml.relationship-edge' || definition.semantic?.family === 'uml.usecase-dependency'
            || definition.semantic?.family === 'uml.state-edge' || definition.semantic?.family === 'uml.activity-edge'
            ? { parallelOrder: this.nextParallelOrder++ } : {}),
          ...(definition.id === 'uml.state-transition' ? { stateTransition: {} } : {}),
          ...(definition.id === 'uml.activity-flow' || definition.id === 'uml.object-flow'
            ? { activityFlow: normalizeActivityFlowData(undefined, definition.id) } : {}),
          ...(definition.semantic?.notation === 'uml' ? { umlSchemaVersion: UML_FOUNDATION_SCHEMA_VERSION } : {}),
          ...(contextForDefinition(definition, this.diagramContext) ? { diagramContext: contextForDefinition(definition, this.diagramContext) } : {}),
          sourceIntent: 'free', targetIntent: 'pending',
          ...connectorBounds({ shapeId: definition.id, x1: w.x, y1: w.y, x2: w.x, y2: w.y, waypoints: [],
            startMarker: definition.connector?.startMarker ?? 'none', endMarker: definition.connector?.endMarker ?? 'none',
            sourceCardinality: definition.connector?.sourceCardinality, targetCardinality: definition.connector?.targetCardinality,
            label: definition.defaultLabel, sw: this.style.sw }),
        };
        this.latchConnectorSource(connector, w.x, w.y);
      } else if (definition.legacyType && isLegacyBoxToolType(definition.legacyType)) {
        this.put(createLegacyBoxShape(definition.legacyType, {
          id: this.currId, x: w.x, y: w.y, shapeId: definition.id,
          params: { ...(definition.defaultParams ?? {}) },
          fill: definition.solid3d ? 'transparent' : this.style.fill,
          stroke: definition.defaultStroke ?? this.style.stroke,
          sw: definition.defaultStrokeWidth ?? this.style.sw,
        }));
      } else {
        const initialData = definition.defaultData ? JSON.parse(JSON.stringify(definition.defaultData)) as Record<string, unknown> : {};
        const objectContext = contextForDefinition(definition, this.diagramContext);
        let umlInitialData = definition.semantic?.notation === 'uml'
          ? normalizeUmlStructuredData(definition, initialData, initialData) : initialData;
        if (definition.semantic?.notation === 'uml')
          umlInitialData = normalizeBehavioralDiagramData(definition, this.currId, umlInitialData,
            objectContext, undefined, undefined);
        const isSequenceObject = definition.semantic?.family?.startsWith('uml.sequence-') || definition.id === 'uml.frame';
        const normalizedInitialData = isSequenceObject
          ? normalizeSequenceDiagramData(umlInitialData, definition.id, this.currId, undefined, definition.height, w.y + definition.height / 2)
          : Object.keys(umlInitialData).length ? umlInitialData : undefined;
        const diagram: DiagramShape = {
          id: this.currId, type: 'diagram', shapeId: definition.id,
          // A solid's board-space x/y is its true projected local origin. During the anchored
          // create gesture this origin is derived from the immutable pointer-down point and the
          // current pointer midpoint, so the down-point stays pinned to the created extent.
          // w/h remain definition-space metadata, never a pivot or recursive resize reference.
          x: w.x, y: w.y, w: definition.solid3d ? definition.width : 0, h: definition.solid3d ? definition.height : 0, rotation: 0,
          fill: definition.solid3d ? 'transparent' : (definition.defaultFill ?? (definition.semantic?.notation === 'uml' ? '#ffffff' : this.style.fill)),
          stroke: definition.defaultStroke ?? (definition.semantic?.notation === 'uml' ? '#0f172a' : this.style.stroke),
          sw: definition.defaultStrokeWidth ?? (definition.semantic?.notation === 'uml' ? 1.5 : this.style.sw),
          ...(definition.defaultText !== undefined ? { text: definition.defaultText } : {}),
          fs: definition.semantic?.notation === 'uml' ? Math.max(12, this.style.fontSize) : this.style.fontSize,
          textColor: '#1f2937', params: { ...(definition.defaultParams ?? {}),
            ...(definition.solid3d ? { rotationZ: SOLID3D_CANVAS_INITIAL_YAW_DEGREES } : {}) },
          ...(definition.semantic?.notation === 'uml' ? { umlSchemaVersion: UML_FOUNDATION_SCHEMA_VERSION } : {}),
          ...(contextForDefinition(definition, this.diagramContext) ? { diagramContext: contextForDefinition(definition, this.diagramContext) } : {}),
          ...(definition.solid3d ? { solid3dPoseVersion: SOLID3D_POSE_VERSION,
            scale3d: normalizeSolid3DScale(definition.geometry as Solid3DGeometry,
              definition.defaultScale3d ?? { x: 1, y: 1, z: 1 }) } : {}),
          ...(normalizedInitialData ? { data: normalizedInitialData } : {}),
          minX: w.x, minY: w.y, maxX: w.x, maxY: w.y,
        };
        this.put(diagram);
        if (definition.solid3d) {
          const geometry = definition.geometry as Solid3DGeometry;
          const initialScale = normalizeSolid3DScale(geometry,
            definition.defaultScale3d ?? { x: 1, y: 1, z: 1 });
          const creationParams = { ...(definition.defaultParams ?? {}),
            rotationZ: SOLID3D_CANVAS_INITIAL_YAW_DEGREES };
          // Calibrate once from the registered default mesh so the default object projects to
          // approximately the same CSS span as the drag at 100% zoom. This is an immutable
          // reference only; temporary projected bounds never feed back into the running gesture.
          const referenceProjection = buildSolid3DProjection(geometry, definition.width, definition.height,
            creationParams, { scale: initialScale, referenceWidth: definition.width,
              referenceHeight: definition.height, center: { x: 0, y: 0 } });
          const referenceBounds = referenceProjection.metadata.projectedBounds;
          const referenceLength = Math.max(1, referenceBounds.maxX - referenceBounds.minX,
            referenceBounds.maxY - referenceBounds.minY);
          const downCanvas = this.clientToCanvas(e.clientX, e.clientY);
          this.solidCreationGesture = Object.freeze({
            state: 'CREATING_3D_SHAPE' as const,
            id: diagram.id,
            shapeId: definition.id,
            anchorWorld: Object.freeze([w.x, w.y]) as readonly [number, number],
            pointerDownClient: Object.freeze([e.clientX, e.clientY]) as readonly [number, number],
            pointerDownCanvas: Object.freeze([downCanvas.x, downCanvas.y]) as readonly [number, number],
            initialScale: Object.freeze({ ...initialScale }),
            referenceLength,
            definitionWidth: definition.width,
            definitionHeight: definition.height,
          });
        }
      }
    }
  }

  private pressureOf(event: PointerEvent, fallback: number): number {
    const pressure = event.pressure;
    return Number.isFinite(pressure) && pressure > 0 ? Math.max(0, Math.min(1, pressure)) : fallback;
  }

  private appendPenSamples(event: PointerEvent, force = false) {
    const shape = this.currId ? this.shapes.get(this.currId) : undefined;
    if (!shape || shape.type !== 'pen') return;
    const stroke = shape as PenShape;
    let samples: PointerEvent[] = [];
    if (typeof event.getCoalescedEvents === 'function') {
      try { samples = event.getCoalescedEvents(); } catch { samples = []; }
    }
    if (!samples.length) samples = [event];
    const lastCoalesced = samples[samples.length - 1];
    if (!lastCoalesced || lastCoalesced.clientX !== event.clientX || lastCoalesced.clientY !== event.clientY ||
        Math.abs((lastCoalesced.pressure || 0.5) - (event.pressure || 0.5)) > 0.015) samples.push(event);

    const points = stroke.pts.slice();
    let minX = stroke.minX, minY = stroke.minY, maxX = stroke.maxX, maxY = stroke.maxY;
    let last = points[points.length - 1];
    let changed = false;

    // Zoom-invariant minimum distance threshold:
    // Requires at least 0.5 screen pixels between sampled points to filter subpixel sensor noise
    // while keeping slow movements completely smooth and responsive at any zoom.
    const minScreenDist = 0.5;
    const minWorldDistSq = (minScreenDist / Math.max(0.01, this.cam.zoom)) ** 2;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      const isLastSample = i === samples.length - 1;
      if (this.activePointerId !== null && Number.isFinite(sample.pointerId) && sample.pointerId !== this.activePointerId) continue;
      const world = this.clientToWorld(sample.clientX, sample.clientY);
      const pressure = this.pressureOf(sample, last?.[2] ?? 0.5);
      const dSq = last ? (world.x - last[0]) ** 2 + (world.y - last[1]) ** 2 : Infinity;
      if (last && !(force && isLastSample && dSq > 1e-6) && dSq < minWorldDistSq && Math.abs(pressure - (last[2] ?? 0.5)) < 0.02) continue;
      
      const ptX = world.x, ptY = world.y;
      last = [ptX, ptY, pressure];
      points.push(last);
      minX = Math.min(minX, ptX); maxX = Math.max(maxX, ptX);
      minY = Math.min(minY, ptY); maxY = Math.max(maxY, ptY);
      changed = true;
    }
    if (!changed) return;
    this.put({ ...stroke, pts: points, minX, minY, maxX, maxY }, {persist:false});
    if (!this.activeSmartDrawing) this.schedulePenPublish(stroke.id);
  }

  private schedulePenPublish(id: string) {
    if (this.pendingPenPublishRaf !== null) return;
    this.pendingPenPublishRaf = requestAnimationFrame(() => {
      this.pendingPenPublishRaf = null;
      if (this.destroyed || this.currId !== id || this.activeSmartDrawing) return;
      const stroke = this.shapes.get(id);
      if (!stroke || stroke.type !== 'pen') return;
      const persisted = this.yMap.get(id) as PenShape | undefined;
      if (persisted && persisted.pts.length === stroke.pts.length) return;
      this.put(stroke, {redraw:false});
    });
  }

  private flushPenPublish() {
    if (this.pendingPenPublishRaf !== null) {
      cancelAnimationFrame(this.pendingPenPublishRaf);
      this.pendingPenPublishRaf = null;
    }
    if (!this.currId || this.activeSmartDrawing) return;
    const stroke = this.shapes.get(this.currId);
    if (!stroke || stroke.type !== 'pen') return;
    const persisted = this.yMap.get(stroke.id) as PenShape | undefined;
    if (!persisted || persisted.pts.length !== stroke.pts.length) this.put(stroke, {redraw:false});
  }

  /** Update an in-progress 3D CREATE gesture from its one immutable pointer-down anchor. */
  private updateAnchoredSolidCreation(shape: DiagramShape, definition: ShapeDefinition, currentWorld: { x: number; y: number }) {
    const gesture = this.solidCreationGesture;
    if (gesture?.state !== 'CREATING_3D_SHAPE' || !definition.solid3d
      || gesture.id !== shape.id || gesture.shapeId !== definition.id) return;
    const geometry = definition.geometry as Solid3DGeometry;
    const dx = currentWorld.x - gesture.anchorWorld[0], dy = currentWorld.y - gesture.anchorWorld[1];
    const dragLength = Math.hypot(dx, dy);
    if (!Number.isFinite(dragLength) || dragLength < 1) return;
    // One Euclidean world-space displacement is converted into semantic local XYZ dimensions.
    // It comes only from the immutable pointer-down anchor and captured default scale: never from
    // temporary projected bounds, the previous resize result, or a generic MOVE/RESIZE gesture.
    // clientToCanvas applies the CSS/backing ratio; canvasToWorld applies camera zoom exactly once.
    const factor = Math.max(0.06, Math.min(64, dragLength / gesture.referenceLength));
    const scale3d = normalizeSolid3DScale(geometry, {
      x: gesture.initialScale.x * factor,
      y: gesture.initialScale.y * factor,
      z: gesture.initialScale.z * factor,
    });
    // Solid meshes are authored about their true local origin, so keeping that origin at the
    // pointer-down point makes the opposite projected edge trail by roughly half the gesture.
    // Use the anchored box-create convention instead: the original down-point remains fixed as
    // an extent corner and the model origin is the midpoint to the current pointer. This is a
    // direct absolute calculation from the immutable anchor (not object movement or re-basing).
    this.put({ ...shape,
      x: gesture.anchorWorld[0] + dx / 2,
      y: gesture.anchorWorld[1] + dy / 2,
      scale3d });
  }

  pointerMove(e: PointerEvent) {
    if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
    const w = this.clientToWorld(e.clientX, e.clientY);

    // ── panning ──
    if (this.isPanning) {
      const pointer = this.clientToCanvas(e.clientX, e.clientY);
      const dsx = pointer.x - this.panRef.sx;
      const dsy = pointer.y - this.panRef.sy;
      this.cam.x = this.panRef.cx - dsx / this.cam.zoom;
      this.cam.y = this.panRef.cy - dsy / this.cam.zoom;
      this.dirty = true;
      return;
    }

    if (this.tool === 'eraser') {
      const target = e.target as HTMLElement | null;
      const blocked = target?.closest?.('.no-canvas, .panel-ui, .toolbar, .popover, .formula-editor-panel, .math-tools-panel, .code-editor-shell');
      if (this.isErasing) {
        if (blocked) {
          this.eraserCursorPoint = null;
          this.eraserLastPoint = null;
          this.dirty = true;
          return;
        }
        this.eraserCursorPoint = w;
        const from = this.eraserLastPoint ?? w;
        this.eraseAlongSegment(from, w);
        this.eraserLastPoint = w;
        this.dirty = true;
        return;
      }
      this.updateEraserHover(e);
    }

    // Active solid transforms use the one captured local basis throughout the pointer gesture.
    if (this.solidTransformGesture) {
      if (this.solidTransformGesture.mode === 'size') this.doResizeSolid3D(e.clientX, e.clientY);
      else this.doRotateSolid3D(e.clientX, e.clientY);
      return;
    }

    // CREATE_3D owns its pointer until pointer-up. It bypasses the generic drawing,
    // selection-move, 2D-resize, and SIZE/ROTATE-gizmo branches entirely.
    if (this.solidCreationGesture) {
      const gesture = this.solidCreationGesture;
      const shape = this.shapes.get(gesture.id);
      const definition = getShapeDefinition(gesture.shapeId);
      if (shape?.type === 'diagram' && definition?.solid3d)
        this.updateAnchoredSolidCreation(shape as DiagramShape, definition, w);
      else this.solidCreationGesture = null;
      return;
    }

    // ── dragging selected shapes ──
    if (this.isDragging) {
      const dx = w.x - this.dragRef.wx;
      const dy = w.y - this.dragRef.wy;
      const lifecycleOwners = new Set<string>();
      this.dragOrigins.forEach((orig, id) => {
        const shape = this.shapes.get(id);
        const origin = this.dragShapeOrigins.get(id) ?? shape;
        if (!shape || !origin) return;
        const isSequenceMessage = origin.type === 'connector'
          && getShapeDefinition((origin as ConnectorShape).shapeId)?.semantic?.family === 'uml.sequence-edge';
        let moved = isSequenceMessage && this.sel.has(id)
          ? this.moveSequenceMessageGesture(origin as ConnectorShape, dx, dy)
          : moveShape(origin, orig.x + dx, orig.y + dy);
        if (moved.type === 'diagram') {
          const definition = getShapeDefinition(moved.shapeId);
          if (definition?.semantic?.family === 'uml.sequence-participant') lifecycleOwners.add(moved.id);
          if (definition?.semantic?.family === 'uml.sequence-control') {
            const owner = moved.containerId ? this.shapes.get(moved.containerId) : undefined;
            if (owner?.type === 'diagram' && getShapeDefinition(owner.shapeId)?.semantic?.family === 'uml.sequence-participant')
              moved = this.normalizeSequenceOwnedControl(moved as DiagramShape, owner as DiagramShape);
            moved = this.sequenceControlWithTemporalMetadata(moved as DiagramShape, this.sel.has(id), false);
            if (moved.shapeId === 'uml.destroy' && moved.containerId) lifecycleOwners.add(moved.containerId);
          }
        }
        this.put(moved);
      });
      for (const ownerId of lifecycleOwners) {
        const owner = this.shapes.get(ownerId);
        if (owner?.type === 'diagram') this.synchronizeSequenceDestruction(owner as DiagramShape);
      }
      // A connector and its endpoint shapes may be selected together. Re-resolve after the
      // complete move so a later connector write cannot replace its newly moved node ports.
      this.dragOrigins.forEach((_, id) => {
        const moved = this.shapes.get(id);
        if (moved && isConnectableShape(moved)) this.updateAttachedConnectors(id);
      });
      if ([...this.dragShapeOrigins.values()].some(origin => origin.type === 'connector'
        && getShapeDefinition((origin as ConnectorShape).shapeId)?.semantic?.family === 'uml.sequence-edge')) {
        this.rebalanceParallelConnectorLanes();
      }
      return;
    }

    // ── resizing ──
    if (this.isResizing && this.resizeRef) {
      this.doResize(w.x, w.y);
      return;
    }

    // ── selection box ──
    if (this.isBoxing) {
      this.boxB = w;
      this.dirty = true;
      return;
    }

    // ── lasso selection ──
    if (this.isLassoing) {
      this.lassoPts.push(w);
      this.dirty = true;
      return;
    }

    // Solid controls and their mode switch have distinct hit regions from ordinary 2D handles.
    if (!this.isDown && !this.isDragging && !this.isResizing && !this.isPanning && !this.isSizing3D && !this.isRotating3D) {
      const selectedSolid = this.sel.size === 1
        ? this.shapes.get([...this.sel][0]) : null;
      const hasSelectedSolidControls = selectedSolid?.type === 'diagram'
        && Boolean(getShapeDefinition(selectedSolid.shapeId)?.solid3d);
      if (this.tool === 'select' || this.tool === 'lasso-select' || hasSelectedSolidControls) {
        const solidControl = this.hitSolidTransformControl(e.clientX, e.clientY);
        const handle = !solidControl && this.tool === 'select' ? this.hitResizeHandle(e.clientX, e.clientY) : null;
        const previous = this.hoveredSolidControl;
        const sameHover = previous?.id === solidControl?.id && previous?.kind === solidControl?.kind
          && previous?.mode === solidControl?.mode
          && (previous?.kind !== 'axis' || (solidControl?.kind === 'axis' && previous.axis === solidControl.axis));
        if (!sameHover) {
          this.hoveredSolidControl = solidControl;
          this.dirty = true;
        }
        if (solidControl?.kind === 'mode') this.onCursor?.('pointer');
        else if (solidControl?.kind === 'axis') this.onCursor?.('grab');
        else if (handle) this.onCursor?.(HANDLE_CURSORS[handle.h] ?? 'nwse-resize');
        else if (this.tool === 'lasso-select') this.onCursor?.('crosshair');
        else if (this.tool === 'select') this.onCursor?.(this.hitShape(w.x, w.y) ? 'move' : 'default');
        else this.onCursor?.(this.cursorForTool());
      }
    }

    // ── drawing / eraser tracking ──
    if (!this.isDown) return;
    const s = this.currId ? this.shapes.get(this.currId) : undefined;
    if (!s) return;

    // ── pen stroke ──
    if (s.type === 'pen') {
      this.appendPenSamples(e);
      return;
    }

    // ── legacy and registered connectors ──
    if (s.type === 'arrow') {
      const a = s as ArrowShape;
      this.put({ ...a, x2: w.x, y2: w.y,
        minX: Math.min(a.x1, w.x), minY: Math.min(a.y1, w.y),
        maxX: Math.max(a.x1, w.x), maxY: Math.max(a.y1, w.y) });
      return;
    }
    if (s.type === 'connector') {
      const connector = s as ConnectorShape;
      const next = { ...connector, x2: w.x, y2: w.y };
      this.put({ ...next, ...connectorBounds(next) });
      this.updateConnectorTargetFeedback(next, w.x, w.y);
      return;
    }

    // ── registered/legacy box shapes ──
    if (isPositionedShape(s)) {
      const definition = s.type === 'diagram' ? getShapeDefinition(s.shapeId) : getShapeDefinitionForLegacyType(s.type);
      // A registered 3D shape is never sent through the generic 2D drag-box resize path.
      if (s.type === 'diagram' && definition?.solid3d) return;
      const box = normalizeDragBox(this.shapeOrigin, w, getShapeCreationResizePolicy(definition), definition);
      const next = { ...s, ...box };
      Object.assign(next, rotatedBoxBounds(next));
      this.put(next as AnyShape);
    }
  }

  pointerUp(eventOrButton?: number | PointerEvent) {
    const event = typeof eventOrButton === 'number' ? undefined : eventOrButton;
    const button = typeof eventOrButton === 'number' ? eventOrButton : eventOrButton?.button;
    if (event && this.activePointerId !== null && Number.isFinite(event.pointerId) && event.pointerId !== this.activePointerId) return;
    if (this.isDown && event && event.button !== undefined && event.button !== 0) return;
    if (this.isPanning) {
      if (button !== undefined && this.panButton !== null && button !== this.panButton) return;
      this.isPanning = false;
      this.panButton = null;
      this.activePointerId = null;
      this.onCameraChange?.(this.cam);
      this.onCursor?.(this.cursorForTool());
      return;
    }
    if (this.isErasing) {
      this.finishErasing(true);
      if (event && this.tool === 'eraser') this.updateEraserHover(event);
      this.onCursor?.(this.cursorForTool());
      return;
    }
    if (this.solidTransformGesture) {
      this.solidTransformGesture = null;
      this.isSizing3D = false;
      this.isRotating3D = false;
      this.activePointerId = null;
      const hover = event ? this.hitSolidTransformControl(event.clientX, event.clientY) : null;
      this.hoveredSolidControl = hover;
      this.onCursor?.(hover?.kind === 'mode' ? 'pointer' : hover ? 'grab' : this.cursorForTool());
      this.saveH();
      this.dirty = true;
      return;
    }
    if (this.isDragging) {
      if ([...this.dragShapeOrigins.values()].some(origin => origin.type === 'connector'
        && getShapeDefinition((origin as ConnectorShape).shapeId)?.semantic?.family === 'uml.sequence-edge'))
        this.synchronizeSequenceActivationRanges();
      const movedIds = [...this.dragShapeOrigins.keys()];
      this.isDragging = false;
      for (const id of movedIds) {
        const moved = this.shapes.get(id);
        if (moved?.type !== 'diagram') continue;
        if (moved.shapeId === 'uml.composite-state') this.reanchorOwnedStatePoints(id, true);
        else if (moved.shapeId === 'uml.entry-point' || moved.shapeId === 'uml.exit-point') {
          const owner = moved.containerId ? this.shapes.get(moved.containerId) : undefined;
          if (owner?.type === 'diagram' && owner.shapeId === 'uml.composite-state')
            this.anchorOwnedStatePoint(moved as DiagramShape, owner as DiagramShape, this, false);
        }
      }
      this.dragOrigins.clear(); this.dragShapeOrigins.clear();
      this.activePointerId = null;
      this.onCursor?.('move');
      this.saveH();
      this.queueGraphDiagnostics();
      return;
    }
    if (this.isResizing) {
      const resizeId = this.resizeRef?.s?.id;
      const resized = resizeId ? this.shapes.get(resizeId) : undefined;
      if (resized?.type === 'connector' && (this.resizeH === 'line-start' || this.resizeH === 'line-end'))
        this.snapConnectorEndpoint(resized as ConnectorShape, this.resizeH === 'line-start' ? 'source' : 'target');
      this.isResizing = false;
      this.activePointerId = null;
      this.resizeH = '';
      this.resizeRef = null;
      if (resized?.type === 'diagram' && resized.shapeId === 'uml.composite-state')
        this.reanchorOwnedStatePoints(resized.id, true);
      this.onCursor?.('default');
      this.saveH();
      this.queueGraphDiagnostics();
      return;
    }
    if (this.isBoxing) {
      this.isBoxing = false;
      this.activePointerId = null;
      const x0=Math.min(this.boxA.x,this.boxB.x), y0=Math.min(this.boxA.y,this.boxB.y);
      const x1=Math.max(this.boxA.x,this.boxB.x), y1=Math.max(this.boxA.y,this.boxB.y);
      if (x1-x0>4 || y1-y0>4) {
        this.shapes.forEach(s => {
          if (s.minX<x1 && s.maxX>x0 && s.minY<y1 && s.maxY>y0) this.sel.add(s.id);
        });
        this.onSel?.([...this.sel]);
      }
      this.dirty = true;
      return;
    }
    
    if (this.isLassoing) {
      this.isLassoing = false;
      this.activePointerId = null;
      if (this.lassoPts.length > 2) {
        const polygon = this.lassoPts.map(point => [point.x, point.y] as [number, number]);
        const tolerance = 3 / Math.max(0.04, this.cam.zoom);
        const minX = Math.min(...polygon.map(point => point[0])) - tolerance;
        const maxX = Math.max(...polygon.map(point => point[0])) + tolerance;
        const minY = Math.min(...polygon.map(point => point[1])) - tolerance;
        const maxY = Math.max(...polygon.map(point => point[1])) + tolerance;
        const candidates = this.rtree.search({ minX, minY, maxX, maxY }) as AnyShape[];
        candidates.forEach(shape => {
          if (this.shapeTouchesLasso(shape, polygon, tolerance)) this.sel.add(shape.id);
        });
      }
      this.lassoPts = [];
      // Lasso is a one-gesture selection tool. Return to normal selection without calling
      // setTool(), which deliberately clears selection for explicit toolbar switches.
      this.tool = 'select';
      this.onTool?.('select');
      this.onSel?.([...this.sel]);
      this.onCursor?.(this.cursorForTool());
      this.dirty = true;
      return;
    }

    if (this.isDown && event && this.currId) {
      const shape = this.shapes.get(this.currId);
      const world = this.clientToWorld(event.clientX, event.clientY);
      if (shape?.type === 'pen' && event.button === 0) {
        this.appendPenSamples(event, true);
      } else if (shape?.type === 'arrow') {
        const arrow = shape as ArrowShape;
        this.put({ ...arrow, x2: world.x, y2: world.y,
          minX: Math.min(arrow.x1, world.x), minY: Math.min(arrow.y1, world.y),
          maxX: Math.max(arrow.x1, world.x), maxY: Math.max(arrow.y1, world.y) });
      } else if (shape?.type === 'connector') {
        const connector = shape as ConnectorShape;
        this.put({ ...connector, x2: world.x, y2: world.y, ...connectorBounds({ ...connector, x2: world.x, y2: world.y }) });
      } else if (shape && isPositionedShape(shape)) {
        const definition = shape.type === 'diagram' ? getShapeDefinition(shape.shapeId) : getShapeDefinitionForLegacyType(shape.type);
        if (shape.type === 'diagram' && definition?.solid3d) {
          if (this.solidCreationGesture?.id === shape.id)
            this.updateAnchoredSolidCreation(shape as DiagramShape, definition, world);
        } else {
          const box = normalizeDragBox(this.shapeOrigin, world, getShapeCreationResizePolicy(definition), definition);
          const defW = definition?.width ?? 120, defH = definition?.height ?? 80;
          const dragScale = Math.max(0.25, Math.min(16, Math.sqrt((box.w / defW) * (box.h / defH))));
          const next = { ...shape, ...box, ...(shape.type === 'diagram' ? { embeddedTextScale: dragScale } : {}) };
          Object.assign(next, rotatedBoxBounds(next));
          this.put(next as AnyShape);
        }
      }
    }
    if (this.isDown && this.currId && !this.activeSmartDrawing) this.flushPenPublish();

    if (this.isDown) {
      this.isDown = false;
      if (this.currId) {
        let shape = this.shapes.get(this.currId);
        if (shape?.type === 'pen' && this.activeSmartDrawing) {
          const converted = this.finalizeSmartStroke(shape as PenShape);
          if (!converted) this.put(shape, {persist:true});
          shape = this.shapes.get(this.currId);
        }
        // Click-to-create uses each registered definition's dimensions; legacy box tools keep 120×80.
        if (this.tool !== 'pen' && shape && isPositionedShape(shape) && (shape.w <= 15 || shape.h <= 15)) {
          const definition = shape.type === 'diagram' ? getShapeDefinition(shape.shapeId) : getShapeDefinitionForLegacyType(shape.type);
          const width = definition?.width ?? 120;
          const height = definition?.height ?? 80;
          if (shape.type === 'diagram' && definition?.solid3d) {
            const resized = { ...shape, w: width, h: height,
              scale3d: normalizeSolid3DScale(definition.geometry as Solid3DGeometry,
                definition.defaultScale3d ?? { x: 1, y: 1, z: 1 }) };
            Object.assign(resized, rotatedBoxBounds(resized));
            this.put(resized);
          } else {
            const resized = { ...shape, w: width, h: height };
            Object.assign(resized, rotatedBoxBounds(resized));
            this.put(resized as AnyShape);
          }
          shape = this.shapes.get(this.currId);
        } else if (shape?.type === 'arrow') {
          const arrow = shape as ArrowShape;
          if (Math.abs(arrow.x2 - arrow.x1) < 5 && Math.abs(arrow.y2 - arrow.y1) < 5)
            this.put({ ...arrow, x2: arrow.x1 + 120, maxX: arrow.x1 + 120 });
          shape = this.shapes.get(this.currId);
        } else if (shape?.type === 'connector') {
          const connector = shape as ConnectorShape;
          if (Math.hypot(connector.x2 - connector.x1, connector.y2 - connector.y1) < 5) {
            const definition = getShapeDefinition(connector.shapeId);
            const moved = { ...connector, x2: connector.x1 + Math.max(60, definition?.width ?? 120), y2: connector.y1 + Math.max(0, definition?.height ?? 0) };
            this.put({ ...moved, ...connectorBounds(moved) });
          }
          shape = this.shapes.get(this.currId);
        }
        if (shape?.type === 'connector') {
          this.snapConnectorEndpoint(shape as ConnectorShape, 'target');
          shape = this.shapes.get(this.currId);
        }
        if (shape?.type === 'diagram') {
          const definition = getShapeDefinition(shape.shapeId);
          const contentDriven = definition?.dataCapabilities?.includes('classifier')
            || definition?.dataCapabilities?.includes('instance')
            || definition?.semantic?.family === 'uml.use-case' || definition?.semantic?.family === 'uml.actor';
          if (contentDriven && definition) {
            const grown = this.growDiagramTextBox(shape, shape.text ?? definition.defaultText ?? definition.label, shape.data);
            if (grown.w !== shape.w || grown.h !== shape.h || grown.fs !== shape.fs || grown.text !== shape.text) {
              this.put(grown); shape = this.shapes.get(shape.id) ?? grown;
            }
          }
        }
        if (shape && (shape.type === 'diagram' || shape.type === 'connector')) this.assignCreatedObjectContainer(shape);

        if (this.tool !== 'pen') {
          this.sel.clear();
          this.sel.add(this.currId);
          this.onSel?.([...this.sel]);
          if (this.tool !== 'select') {
            if (!this.previousCreationTool) this.previousCreationTool = this.tool;
            this.tool = 'select';
            this.onTool?.('select');
          }
          this.dirty = true;
        } else {
          this.clearSelection();
          this.dirty = true;
        }

        this.currId = null;
        this.solidCreationGesture = null;
        this.activeSmartDrawing = false;
        this.saveH();
        this.mark();
      }
      this.activePointerId = null;
      this.connectorSourceFeedback = null;
    }
  }

  doubleClick(e: MouseEvent) {
    if (this.isReadOnly) return;
    const w = this.clientToWorld(e.clientX, e.clientY);
    const hit = this.hitShape(w.x, w.y);
    if (!hit) return;
    if (isDoubleClickTextEditableShape(hit)) {
      this.sel.clear(); this.sel.add(hit.id); this.onSel?.([hit.id]);
      this.dirty = true;
      this.onEditText?.(hit, e.clientX, e.clientY);
      return;
    }
    if (hit.type === 'diagram' || hit.type === 'connector') {
      this.sel.clear(); this.sel.add(hit.id); this.onSel?.([hit.id]);
      this.dirty = true;
      this.onEditSemantic?.(hit);
      return;
    }
  }

  public updateSize(id: string, w: number, h: number) {
    const shape = this.shapes.get(id);
    if (!shape || !('w' in shape) || (shape.w === w && shape.h === h)) return;
    let resizedShape: AnyShape = { ...shape, w, h } as AnyShape;
    if (shape.type === 'diagram') {
      const diagram = shape as DiagramShape, definition = getShapeDefinition(diagram.shapeId);
      if (definition?.solid3d) {
        const geometry = definition.geometry as Solid3DGeometry;
        const base = normalizeSolid3DScale(geometry, diagram.scale3d ?? definition.defaultScale3d
          ?? solid3DScaleFromBounds(diagram.w, diagram.h, definition.width, definition.height, geometry));
        const ratioX = Math.max(0.01, w / Math.max(1, diagram.w));
        const ratioY = Math.max(0.01, h / Math.max(1, diagram.h));
        let scale3d: Solid3DScale;
        if (geometry === 'cube3d' || geometry === 'sphere3d') {
          const factor = Math.min(ratioX, ratioY);
          scale3d = normalizeSolid3DScale(geometry, { x: base.x * factor, y: base.y * factor, z: base.z * factor });
        } else if (geometry === 'cylinder3d' || geometry === 'cone3d' || geometry === 'coneFrustum3d') {
          const radial = base.x * ratioX;
          scale3d = normalizeSolid3DScale(geometry, { x: radial, y: radial, z: base.z * ratioY });
        } else if (geometry === 'cuboid3d') {
          scale3d = normalizeSolid3DScale(geometry, { x: base.x * ratioX, y: base.y, z: base.z * ratioY });
        } else if (['pyramid3d', 'pentagonalPyramid3d', 'hexagonalPyramid3d', 'pyramidFrustum3d',
          'squarePrism3d', 'pentagonalPrism3d', 'hexagonalPrism3d'].includes(geometry)) {
          scale3d = normalizeSolid3DScale(geometry, { x: base.x * ratioX, y: base.y * ratioX, z: base.z * ratioY });
        } else {
          scale3d = normalizeSolid3DScale(geometry, { x: base.x * ratioX, y: base.y * ratioY, z: base.z });
        }
        // 3D x/y are the true model origin; resizing changes dimensions without recentering it.
        resizedShape = { ...diagram, w, h, scale3d };
      }
    }
    if (shape.type === 'diagram' && getShapeDefinition((shape as DiagramShape).shapeId)?.semantic?.container
      && !this.containerResizeAllowed(shape as DiagramShape, resizedShape as DiagramShape)) return;
    const resized = withComputedShapeBounds(resizedShape);
    // Formula overlays can report a final measured layout just after committing source.
    // Keep that same-object measurement in the edit's existing undo item.
    this.put(resized, { redraw: id !== this.editingId,
      ...(this.pendingFormulaCaptureId === id ? { historyContinuationId: id } : {}) });
    if (shape.type === 'diagram' && (shape as DiagramShape).shapeId === 'uml.composite-state' && !this.isResizing)
      this.reanchorOwnedStatePoints(id, true);
  }

  public updatePos(id: string, x: number, y: number) {
    const s = this.shapes.get(id);
    if (s && isPositionedShape(s)) {
      // For box shapes (sticky, text, math, code, rect, etc.)
      const news = withComputedShapeBounds({ ...s, x, y });
      this.put(news);
    } else if (s && s.type === 'pen') {
      const pen = s as PenShape;
      const dx = x - pen.minX;
      const dy = y - pen.minY;
      const news: PenShape = {
        ...pen,
        pts: pen.pts.map(p => [p[0] + dx, p[1] + dy, p[2]]),
        minX: x, minY: y, maxX: pen.maxX + dx, maxY: pen.maxY + dy
      };
      this.put(news);
    } else if (s && s.type === 'line') {
      const line = s as LineShape;
      const dx = x - line.x1, dy = y - line.y1;
      this.put({ ...line, x1: x, y1: y, x2: line.x2 + dx, y2: line.y2 + dy,
        minX: Math.min(x, line.x2 + dx), minY: Math.min(y, line.y2 + dy),
        maxX: Math.max(x, line.x2 + dx), maxY: Math.max(y, line.y2 + dy) });
    } else if (s && s.type === 'curve') {
      const curve = s as CurveShape;
      const dx = x - curve.minX, dy = y - curve.minY;
      this.put({ ...curve, pts: curve.pts.map(point => [point[0] + dx, point[1] + dy, point[2]]),
        minX: x, minY: y, maxX: curve.maxX + dx, maxY: curve.maxY + dy });
    } else if (s && s.type === 'arrow') {
      const a = s as ArrowShape;
      const dx = x - a.x1;
      const dy = y - a.y1;
      const news: ArrowShape = {
        ...a,
        x1: x, y1: y, x2: a.x2 + dx, y2: a.y2 + dy,
        minX: Math.min(x, a.x2 + dx), minY: Math.min(y, a.y2 + dy),
        maxX: Math.max(x, a.x2 + dx), maxY: Math.max(y, a.y2 + dy)
      };
      this.put(news);
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────────
  private transactMap(work: () => void, origin: object = this) {
    const document = this.yMap.doc;
    if (document) document.transact(work, origin);
    else work();
  }

  private closePendingFormulaCapture(continuationShapeId?: string) {
    if (!this.pendingFormulaCaptureId || this.pendingFormulaCaptureId === continuationShapeId) return;
    this.pendingFormulaCaptureId = null;
    this.undoManager.stopCapturing();
  }

  private addIndexedId(index: Map<string, Set<string>>, ownerId: string | undefined, id: string) {
    if (!ownerId) return;
    const ids = index.get(ownerId) ?? new Set<string>();
    ids.add(id); index.set(ownerId, ids);
  }

  private removeIndexedId(index: Map<string, Set<string>>, ownerId: string | undefined, id: string) {
    if (!ownerId) return;
    const ids = index.get(ownerId);
    if (!ids) return;
    ids.delete(id);
    if (!ids.size) index.delete(ownerId);
  }

  private addShapeIndexes(shape: AnyShape) {
    if ('containerId' in shape && typeof shape.containerId === 'string')
      this.addIndexedId(this.ownedIdsByContainer, shape.containerId, shape.id);
    if (shape.type === 'connector') {
      this.addIndexedId(this.connectorIdsByEndpoint, shape.sourceRef?.shapeId, shape.id);
      if (shape.targetRef?.shapeId !== shape.sourceRef?.shapeId)
        this.addIndexedId(this.connectorIdsByEndpoint, shape.targetRef?.shapeId, shape.id);
    }
  }

  private removeShapeIndexes(shape: AnyShape) {
    if ('containerId' in shape && typeof shape.containerId === 'string')
      this.removeIndexedId(this.ownedIdsByContainer, shape.containerId, shape.id);
    if (shape.type === 'connector') {
      this.removeIndexedId(this.connectorIdsByEndpoint, shape.sourceRef?.shapeId, shape.id);
      if (shape.targetRef?.shapeId !== shape.sourceRef?.shapeId)
        this.removeIndexedId(this.connectorIdsByEndpoint, shape.targetRef?.shapeId, shape.id);
    }
  }

  private put(shape: AnyShape, options: { redraw?: boolean; notify?: boolean; persist?: boolean; syncAttachments?: boolean; origin?: object; historyContinuationId?: string } = {}) {
    const isTrackedLocalWrite = options.persist !== false && (options.origin ?? this) === this;
    if (isTrackedLocalWrite) this.closePendingFormulaCapture(options.historyContinuationId);
    const s = withComputedShapeBounds(shape);
    const old = this.shapes.get(s.id);
    if (old) { this.rtree.remove(old); this.removeShapeIndexes(old); }
    this.shapes.set(s.id, s);
    this.rtree.insert(s);
    this.addShapeIndexes(s);
    if (options.persist !== false) this.transactMap(() => this.yMap.set(s.id, s), options.origin ?? this);
    if (options.redraw !== false) this.dirty = true;
    if (options.notify !== false) this.onShapeUpdate?.(s);
    if (options.syncAttachments !== false && isConnectableShape(s)) this.updateAttachedConnectors(s.id);
    if (s.type === 'diagram') this.ensureUseCaseChildFitsBoundary(s as DiagramShape, options.origin ?? this);
    this.queueGraphDiagnostics();
  }

  /** Commit a semantic subgraph as one Yjs transaction and one undo item. */
  private putMany(shapes: AnyShape[], options: { redraw?: boolean; notify?: boolean; persist?: boolean; syncAttachments?: boolean; origin?: object } = {}) {
    if (!shapes.length) return;
    const origin = options.origin ?? this;
    const isTrackedLocalWrite = options.persist !== false && origin === this;
    if (isTrackedLocalWrite) this.closePendingFormulaCapture();
    const normalized = shapes.map(withComputedShapeBounds);
    for (const shape of normalized) {
      const old = this.shapes.get(shape.id);
      if (old) { this.rtree.remove(old); this.removeShapeIndexes(old); }
      this.shapes.set(shape.id, shape);
      this.rtree.insert(shape);
      this.addShapeIndexes(shape);
    }
    if (options.persist !== false) this.transactMap(() => normalized.forEach(shape => this.yMap.set(shape.id, shape)), origin);
    if (options.redraw !== false) this.dirty = true;
    if (options.notify !== false) normalized.forEach(shape => this.onShapeUpdate?.(shape));
    if (options.syncAttachments !== false) normalized.filter(isConnectableShape).forEach(shape => this.updateAttachedConnectors(shape.id));
    normalized.filter((shape): shape is DiagramShape => shape.type === 'diagram')
      .forEach(shape => this.ensureUseCaseChildFitsBoundary(shape, origin));
    this.queueGraphDiagnostics();
  }

  private deleteShapes(ids: string[]): string[] {
    const idsToRemove = new Set(ids);
    for (const id of [...idsToRemove]) {
      const shape = this.shapes.get(id);
      if (shape?.type !== 'diagram' || getShapeDefinition(shape.shapeId)?.semantic?.family !== 'uml.sequence-participant') continue;
      for (const child of this.containedDescendants(shape.id)) {
        if (child.containerId === shape.id && getShapeDefinition(child.shapeId)?.semantic?.family === 'uml.sequence-control')
          idsToRemove.add(child.id);
      }
    }
    const removed = [...idsToRemove].flatMap(id => {
      const shape = this.shapes.get(id);
      return shape ? [{ id, shape }] : [];
    });
    if (!removed.length) return [];
    const removedIds = new Set(removed.map(({ id }) => id));
    const removedMessageIds = new Set(removed.flatMap(({ shape }) => shape.type === 'connector'
      && getShapeDefinition(shape.shapeId)?.semantic?.family === 'uml.sequence-edge'
      ? [shape.id, shape.sequenceEvent?.eventId].filter((value): value is string => Boolean(value)) : []));
    const removedParticipantIds = new Set(removed.filter(({ shape }) => shape.type === 'diagram'
      && getShapeDefinition(shape.shapeId)?.semantic?.family === 'uml.sequence-participant').map(({ id }) => id));
    const removedFrameIds = new Set(removed.filter(({ shape }) => shape.type === 'diagram' && shape.shapeId === 'uml.frame')
      .map(({ id }) => id));
    const connectorsReleasedByFrame = new Set([...this.shapes.values()].flatMap(shape => shape.type === 'connector'
      && (removedFrameIds.has(shape.containerId ?? '') || removedFrameIds.has(shape.sequenceEvent?.fragmentId ?? '')) ? [shape.id] : []));
    const affectedLifelines = new Set(removed.flatMap(({ shape }) => shape.type === 'diagram'
      && shape.shapeId === 'uml.destroy' && shape.containerId ? [shape.containerId] : []));
    this.closePendingFormulaCapture();
    // Start deletion as its own undo unit, even when a prior live property edit and Delete occur
    // in the same event turn. Semantic cleanup below is committed atomically with these removals.
    this.undoManager.stopCapturing();

    for (const { id, shape } of removed) {
      if (isConnectableShape(shape)) this.detachConnectorsFrom(id);
      if (shape.type === 'diagram') this.detachContainedChildrenFrom(id, this);
    }

    // A removed Sequence fragment releases its event memberships and frame ownership, but leaves
    // the enclosed participants and messages intact as ordinary Sequence objects.
    for (const candidate of [...this.shapes.values()]) {
      if (candidate.type !== 'connector') continue;
      const connector = candidate as ConnectorShape;
      const fragment = connector.sequenceEvent?.fragmentId;
      const frameOwner = connector.containerId;
      if (!connectorsReleasedByFrame.has(connector.id)
        && (!fragment || !removedFrameIds.has(fragment)) && (!frameOwner || !removedFrameIds.has(frameOwner))) continue;
      const sequenceEvent = connector.sequenceEvent ? { ...connector.sequenceEvent } : undefined;
      if (sequenceEvent) { delete sequenceEvent.fragmentId; delete sequenceEvent.operandId; }
      const next = { ...connector, ...(sequenceEvent ? { sequenceEvent } : {}),
        ...(frameOwner && removedFrameIds.has(frameOwner) ? { containerId: undefined } : {}) };
      this.put(next, { notify: false, syncAttachments: false });
    }

    // Remove stale return/endpoint ownership links; a free/incomplete message remains editable,
    // but no Sequence event retains a participant, message, or frame identity that was deleted.
    for (const candidate of [...this.shapes.values()]) {
      if (candidate.type !== 'connector' || getShapeDefinition(candidate.shapeId)?.semantic?.family !== 'uml.sequence-edge') continue;
      const connector = candidate as ConnectorShape;
      if (removedIds.has(connector.id) || !connector.sequenceEvent) continue;
      const sequenceEvent = { ...connector.sequenceEvent };
      if (sequenceEvent.returnForMessageId && removedMessageIds.has(sequenceEvent.returnForMessageId))
        delete sequenceEvent.returnForMessageId;
      if (sequenceEvent.sourceEndpointId && removedIds.has(sequenceEvent.sourceEndpointId))
        delete sequenceEvent.sourceEndpointId;
      if (sequenceEvent.targetEndpointId && removedIds.has(sequenceEvent.targetEndpointId))
        delete sequenceEvent.targetEndpointId;
      if (sequenceEvent.sourceParticipantId && removedParticipantIds.has(sequenceEvent.sourceParticipantId))
        delete sequenceEvent.sourceParticipantId;
      if (sequenceEvent.targetParticipantId && removedParticipantIds.has(sequenceEvent.targetParticipantId))
        delete sequenceEvent.targetParticipantId;
      const sameParticipant = Boolean(sequenceEvent.sourceParticipantId
        && sequenceEvent.sourceParticipantId === sequenceEvent.targetParticipantId);
      sequenceEvent.selfCall = sameParticipant || undefined;
      if (!sameParticipant) {
        delete sequenceEvent.targetVisualY;
        if (sequenceEvent.kind === 'self-call') sequenceEvent.kind = 'synchronous';
      }
      if (JSON.stringify(sequenceEvent) !== JSON.stringify(connector.sequenceEvent))
        this.put({ ...connector, sequenceEvent }, { notify: false, syncAttachments: false });
    }
    for (const { shape } of removed) if (shape.type === 'connector' && shape.shapeId === 'uml.create-message')
      this.synchronizeSequenceCreateOwnership({ ...(shape as ConnectorShape), targetRef: undefined }, this);

    this.transactMap(() => removed.forEach(({ id }) => this.yMap.delete(id)));
    removed.forEach(({ id, shape }) => {
      // Detaching a deleted container/node can replace child or connector objects that are also
      // scheduled for deletion. Remove the current indexed instance, not the pre-detach snapshot,
      // otherwise RBush retains a renderable ghost after its ID leaves the model map.
      const indexedShape = this.shapes.get(id);
      this.rtree.remove(indexedShape ?? shape);
      if (indexedShape) this.removeShapeIndexes(indexedShape);
      else this.removeShapeIndexes(shape);
      if (shape.type === 'code') this.codePreviewCache.forget(id);
      this.shapes.delete(id);
    });
    for (const ownerId of affectedLifelines) {
      const owner = this.shapes.get(ownerId);
      if (owner?.type === 'diagram') this.synchronizeSequenceDestruction(owner as DiagramShape);
    }
    if (removed.some(({ shape }) => shape.type === 'connector'
      && getShapeDefinition(shape.shapeId)?.semantic?.family === 'uml.sequence-edge'))
      this.synchronizeSequenceActivationRanges();
    this.rebalanceParallelConnectorLanes();
    this.dirty = true;
    this.queueGraphDiagnostics();
    return removed.map(({ id }) => id);
  }

  private del(id: string): boolean {
    return this.deleteShapes([id]).length > 0;
  }

  private eraseAlongSegment(from: { x: number; y: number }, to: { x: number; y: number }) {
    const radius = ERASER_RADIUS_PX / Math.max(0.04, this.cam.zoom);
    const broadPhase = radius + MAX_PEN_STROKE_WIDTH / 2 + 22;
    const candidates = this.rtree.search({
      minX: Math.min(from.x, to.x) - broadPhase,
      minY: Math.min(from.y, to.y) - broadPhase,
      maxX: Math.max(from.x, to.x) + broadPhase,
      maxY: Math.max(from.y, to.y) + broadPhase,
    }) as AnyShape[];
    const removedIds = this.deleteShapes(candidates.filter(shape => eraserSegmentTouchesShape(shape, from, to, radius)).map(shape => shape.id));
    if (removedIds.length) {
      this.eraseChanged = true;
      let selectionChanged = false;
      removedIds.forEach(id => { selectionChanged = this.sel.delete(id) || selectionChanged; });
      if (selectionChanged) this.onSel?.([...this.sel]);
    }
  }

  private updateEraserHover(event: PointerEvent) {
    const rect = this.cv.getBoundingClientRect();
    const target = event.target as HTMLElement | null;
    const blocked = target?.closest?.('.no-canvas, .panel-ui, .toolbar, .popover, .formula-editor-panel, .math-tools-panel, .code-editor-shell');
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    this.eraserCursorPoint = inside && !blocked ? this.clientToWorld(event.clientX, event.clientY) : null;
    this.dirty = true;
  }

  private finishErasing(preserveCursor = false) {
    this.isErasing = false;
    this.isDown = false;
    this.activePointerId = null;
    this.eraserLastPoint = null;
    if (!preserveCursor) this.eraserCursorPoint = null;
    if (this.eraseChanged) this.saveH();
    this.eraseChanged = false;
    this.dirty = true;
  }

  private finalizeSmartStroke(stroke: PenShape): boolean {
    const result = recognizeSmartDrawing(stroke.pts, stroke.size);
    if (result.kind === 'unchanged') return false;
    if (result.kind === 'line' || result.kind === 'arrow') {
      if (result.points.length < 2) return false;
      const [first, last] = result.points;
      if (!Number.isFinite(first[0]) || !Number.isFinite(first[1]) || !Number.isFinite(last[0]) || !Number.isFinite(last[1])) return false;
      if (result.kind === 'arrow') {
        this.put({
          id: stroke.id, type: 'arrow',
          x1: first[0], y1: first[1], x2: last[0], y2: last[1],
          color: stroke.color, sw: stroke.size,
          minX: Math.min(first[0], last[0]), minY: Math.min(first[1], last[1]),
          maxX: Math.max(first[0], last[0]), maxY: Math.max(first[1], last[1]),
        } as ArrowShape);
        return true;
      }
      this.put({
        id: stroke.id, type: 'line',
        x1: first[0], y1: first[1], x2: last[0], y2: last[1],
        color: stroke.color, sw: stroke.size,
        minX: Math.min(first[0], last[0]), minY: Math.min(first[1], last[1]),
        maxX: Math.max(first[0], last[0]), maxY: Math.max(first[1], last[1]),
      } as LineShape);
      return true;
    }
    if (result.kind === 'heart') {
      const bounds = result.bounds;
      if (!bounds || !Number.isFinite(bounds.x + bounds.y + bounds.w + bounds.h) || bounds.w <= 0 || bounds.h <= 0) return false;
      this.put({
        id: stroke.id,
        type: 'diagram',
        shapeId: 'basic.heart',
        x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h,
        fill: 'transparent', stroke: stroke.color, sw: stroke.size,
        minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.w, maxY: bounds.y + bounds.h,
      } as DiagramShape);
      return true;
    }
    if (result.kind !== 'rectangle' && result.kind !== 'ellipse' && result.kind !== 'triangle' && result.kind !== 'diamond' && result.kind !== 'star' && result.kind !== 'parallelogram' && result.kind !== 'trapezoid') return false;
    const bounds = result.bounds;
    if (!bounds || !Number.isFinite(bounds.x + bounds.y + bounds.w + bounds.h) || bounds.w <= 0 || bounds.h <= 0) return false;
    let { x, y, w, h } = bounds;
    // Miro-standard: If ellipse is near 1:1 (ratio <= 1.25), snap to true circle; if elongated, keep clean ellipse
    let shapeRotation = result.rotation;
    if (result.kind === 'ellipse') {
      const ratio = Math.max(w, h) / Math.min(w, h);
      if (ratio <= 1.25) {
        const side = (w + h) / 2;
        x -= (side - w) / 2;
        y -= (side - h) / 2;
        w = side;
        h = side;
        shapeRotation = undefined;
      } else if (shapeRotation !== undefined) {
        const absRot = Math.abs(shapeRotation);
        if (absRot < 15 || Math.abs(absRot - 90) < 15) {
          shapeRotation = undefined;
        }
      }
    } else if (result.kind === 'rectangle') {
      const ratio = Math.max(w, h) / Math.min(w, h);
      if (ratio <= 1.08) {
        const side = (w + h) / 2;
        x -= (side - w) / 2;
        y -= (side - h) / 2;
        w = side;
        h = side;
      }
    }
    const vertices = (result.kind === 'triangle' || result.kind === 'rectangle' || result.kind === 'parallelogram' || result.kind === 'trapezoid') && result.vertices
      ? result.vertices.map(([vx, vy]) => [(vx - bounds.x) / bounds.w, (vy - bounds.y) / bounds.h] as [number, number])
      : undefined;
    const type = result.kind === 'rectangle' ? 'rect' : result.kind;
    this.put({
      id: stroke.id,
      type,
      x, y, w, h,
      fill: 'transparent', stroke: stroke.color, sw: stroke.size,
      minX: x, minY: y, maxX: x + w, maxY: y + h,
      ...(shapeRotation && Math.abs(shapeRotation) >= 1.0 ? { rotation: shapeRotation } : {}),
      ...(vertices ? { vertices } : {}),
    } as AnyShape);
    return true;
  }

  public hitShape(wx: number, wy: number): AnyShape|null {
    const P = 8/this.cam.zoom;
    const hits = this.rtree.search({minX:wx-P, minY:wy-P, maxX:wx+P, maxY:wy+P}) as AnyShape[];
    const point = { x: wx, y: wy };
    const preciseHits = hits.filter(shape => {
      if (shape.type === 'line' || shape.type === 'arrow') {
        const line = shape as LineShape | ArrowShape;
        return pointToSegmentDistance(point, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }) <= P + line.sw / 2;
      }
      if (shape.type === 'connector') {
        const connector = shape as ConnectorShape, route = getConnectorRoute(connector);
        if (route.slice(1).some((sample, index) => pointToSegmentDistance(point,
          { x: route[index][0], y: route[index][1] }, { x: sample[0], y: sample[1] }) <= P + connector.sw / 2)) return true;
        return this.connectorLabelVisuals(connector, route).some(label =>
          Math.abs(point.x - label.x) <= label.width / 2 + P
          && Math.abs(point.y - label.y) <= label.height / 2 + P);
      }
      if (shape.type === 'curve') {
        const curve = shape as CurveShape;
        return curve.pts.length === 1
          ? Math.hypot(wx - curve.pts[0][0], wy - curve.pts[0][1]) <= P + curve.sw / 2
          : curve.pts.slice(1).some((sample, index) => pointToSegmentDistance(point,
            { x: curve.pts[index][0], y: curve.pts[index][1] }, { x: sample[0], y: sample[1] }) <= P + curve.sw / 2);
      }
      if (shape.type === 'diagram') return pointTouchesDiagram(shape as DiagramShape, point, P);
      if (isBoxShapeTool(shape.type)) {
        const vertices = getShapeVertices(shape);
        if (vertices.length >= 3) {
          const inside = pointInsidePolygon(point, vertices);
          if (inside) return true;
          return vertices.some((vertex, index) => pointToSegmentDistance(point,
            { x: vertex[0], y: vertex[1] }, { x: vertices[(index + 1) % vertices.length][0], y: vertices[(index + 1) % vertices.length][1] }) <= P + shapeStrokeWidth(shape) / 2);
        }
      }
      return true;
    });
    const containmentDepth = (shape: AnyShape) => {
      if (shape.type !== 'diagram') return 0;
      let depth = 0, parentId = (shape as DiagramShape).containerId;
      const visited = new Set<string>([shape.id]);
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = this.shapes.get(parentId);
        if (parent?.type !== 'diagram') break;
        depth++;
        parentId = (parent as DiagramShape).containerId;
      }
      return depth;
    };
    // Match the painter's semantic layering: a contained child wins where its real geometry is
    // hit, connectors/lines beat large background boxes, and smaller shapes beat large containers.
    const hitPriority = (shape: AnyShape) => {
      const isStrokeOnly = isConnectorShape(shape) || shape.type === 'curve' || shape.type === 'pen';
      const depth = containmentDepth(shape);
      let areaPenalty = 0;
      if ('w' in shape && 'h' in shape && typeof shape.w === 'number' && typeof shape.h === 'number') {
        const area = Math.max(1, shape.w * shape.h);
        areaPenalty = Math.min(100, Math.log10(area) * 15);
      }
      return (depth * 1000) + (isStrokeOnly ? 500 : 0) - areaPenalty;
    };
    preciseHits.sort((a, b) => hitPriority(a) - hitPriority(b) || a.id.localeCompare(b.id));
    return preciseHits[preciseHits.length-1] ?? null;
  }

  private diagramTouchesLasso(shape: DiagramShape, polygon: [number, number][], tolerance: number): boolean {
    const definition = getShapeDefinition(shape.shapeId);
    if (!definition) return false;
    const { outlines, decorations, intrinsicFills } = getDiagramPathGroups(shape);
    const strokeRadius = tolerance + Math.max(0, shape.sw) / 2;
    // Closed canonical silhouettes are treated as bounded shape regions even when their paint
    // fill is transparent. Open semantic marks (Actor limbs, lifelines, notation rules) remain
    // stroke geometry. Table/classifier text belongs to the parent semantic object, never cells.
    for (const path of outlines) {
      if (path.length >= 3 && isClosedPath(path)) {
        if (lassoTouchesArea(polygon, path, strokeRadius)) return true;
      } else if (lassoTouchesPolyline(polygon, path, strokeRadius)) return true;
    }
    for (const path of intrinsicFills) if (lassoTouchesArea(polygon, path, strokeRadius)) return true;
    for (const path of decorations) {
      if (path.length >= 3 && isClosedPath(path) && lassoTouchesArea(polygon, path, strokeRadius)) return true;
      if (lassoTouchesPolyline(polygon, path, strokeRadius)) return true;
    }
    return false;
  }

  private shapeTouchesLasso(shape: AnyShape, polygon: [number, number][], tolerance: number): boolean {
    if (shape.type === 'pen') {
      const pen = shape as PenShape;
      return lassoTouchesPolyline(polygon, pen.pts.map(point => [point[0], point[1]]), tolerance + Math.max(0, pen.size) / 2);
    }
    if (shape.type === 'curve') {
      const curve = shape as CurveShape;
      return lassoTouchesPolyline(polygon, curve.pts.map(point => [point[0], point[1]]), tolerance + Math.max(0, curve.sw) / 2);
    }
    if (shape.type === 'line' || shape.type === 'arrow') {
      const line = shape as LineShape | ArrowShape;
      const radius = tolerance + Math.max(0, line.sw) / 2;
      if (lassoTouchesPolyline(polygon, [[line.x1, line.y1], [line.x2, line.y2]], radius)) return true;
      if (shape.type === 'arrow') {
        const marker = legacyArrowHeadPolygon(shape as ArrowShape);
        if (marker.length && lassoTouchesArea(polygon, marker, radius)) return true;
      }
      return false;
    }
    if (shape.type === 'connector') {
      const connector = shape as ConnectorShape, route = getConnectorRoute(connector);
      const radius = tolerance + Math.max(0, connector.sw) / 2;
      if (lassoTouchesPolyline(polygon, route, radius)) return true;
      const markerSize = Math.max(8, connector.sw * 3.1);
      const endpointMarkers = [
        { marker: connector.startMarker, point: route[0], neighbor: route[1] ?? route[0] },
        { marker: connector.endMarker, point: route.at(-1) ?? route[0], neighbor: route.at(-2) ?? route[0] },
      ];
      for (const endpoint of endpointMarkers) {
        for (const markerPath of connectorMarkerPaths(endpoint.marker, endpoint.point, endpoint.neighbor, markerSize)) {
          if (isClosedPath(markerPath) ? lassoTouchesArea(polygon, markerPath, radius)
            : lassoTouchesPolyline(polygon, markerPath, radius)) return true;
        }
      }
      const cardinalityRadius = Math.max(9, connector.sw * 3) * 1.55 + radius;
      if (connector.sourceCardinality && lassoTouchesArea(polygon, circlePolygon(route[0], cardinalityRadius), 0)) return true;
      const end = route.at(-1) ?? route[0];
      if (connector.targetCardinality && lassoTouchesArea(polygon, circlePolygon(end, cardinalityRadius), 0)) return true;
      for (const label of this.connectorLabelVisuals(connector, route)) {
        if (lassoTouchesArea(polygon, [[label.x - label.width / 2, label.y - label.height / 2],
          [label.x + label.width / 2, label.y - label.height / 2], [label.x + label.width / 2, label.y + label.height / 2],
          [label.x - label.width / 2, label.y + label.height / 2]], tolerance)) return true;
      }
      return false;
    }
    if (shape.type === 'diagram') return this.diagramTouchesLasso(shape as DiagramShape, polygon, tolerance);
    if ('x' in shape && 'w' in shape && 'h' in shape) {
      const box = shape as BoxShape;
      if (isBoxShapeTool(shape.type)) {
        const definition = getShapeDefinitionForLegacyType(shape.type) ?? getShapeDefinitionByToolId(shape.type);
        if (definition) {
          const vertices = getShapeVertices(shape);
          if (vertices.length >= 3) return lassoTouchesArea(polygon, vertices, tolerance + shapeStrokeWidth(shape) / 2);
          const legacyDiagram = { ...shape, type: 'diagram', shapeId: definition.id,
            params: { ...(definition.defaultParams ?? {}), ...(box.params ?? {}) } } as unknown as DiagramShape;
          return this.diagramTouchesLasso(legacyDiagram, polygon, tolerance);
        }
      }
      // Text, sticky notes, images and other DOM-backed boxes are selected by their rotated frame.
      return lassoTouchesArea(polygon, rotatedBoxCorners(box), tolerance);
    }
    return false;
  }

  /**
   * One screen-space local XYZ basis drives SIZE and ROTATE. The model center is the shared pivot;
   * dimension derivatives use the true local mesh spans and projection scale, never the AABB.
   */
  private solidTransformBasis(shape: DiagramShape): SolidTransformBasis | null {
    const definition = getShapeDefinition(shape.shapeId);
    if (!definition?.solid3d) return null;
    const geometry = definition.geometry as Solid3DGeometry;
    const params = { ...(definition.defaultParams ?? {}), ...(shape.params ?? {}) };
    const scale = normalizeSolid3DScale(geometry, shape.scale3d ?? definition.defaultScale3d
      ?? solid3DScaleFromBounds(shape.w, shape.h, definition.width, definition.height, geometry));
    const cachedGeometry = this.cachedDiagramGeometry(shape);
    const projectionScale = Math.max(1e-4, cachedGeometry.projection?.projectedScale
      ?? buildSolid3DProjection(geometry, shape.w, shape.h, params, {
        scale, referenceWidth: definition.width, referenceHeight: definition.height, center: { x: 0, y: 0 },
      }).metadata.projectedScale);
    const spans = solid3DLocalAxisSpans(geometry, params);
    const frames = solid3DRotationFrames(params);
    const projectedAxes = projectSolid3DAxes(params);
    const axesById = new Map(projectedAxes.map(axis => [axis.axis, axis]));
    // The 3D model origin is the one pivot for rendered geometry, controls, and interaction.
    const pivotWorld: [number, number] = [shape.x, shape.y];
    const pivotClientPoint = this.worldToClient(pivotWorld[0], pivotWorld[1]);
    const pivotClient: [number, number] = [pivotClientPoint.x, pivotClientPoint.y];
    const rect = this.cv.getBoundingClientRect();
    const clientPerWorldX = rect.width > 0 ? this.cam.zoom * rect.width / this.cv.width : this.cam.zoom;
    const clientPerWorldY = rect.height > 0 ? this.cam.zoom * rect.height / this.cv.height : this.cam.zoom;
    const toClientVector = (screenX: number, screenY: number): [number, number] => {
      const rotated = rotatePoint(screenX, screenY, 0, 0, shape.rotation ?? 0);
      return [rotated[0] * clientPerWorldX, rotated[1] * clientPerWorldY];
    };
    const localBounds = cachedGeometry.projection?.projectedBounds;
    const modelRadiusWorld = localBounds
      ? Math.max(Math.abs(localBounds.minX), Math.abs(localBounds.maxX), Math.abs(localBounds.minY), Math.abs(localBounds.maxY))
      : Math.max(definition.width, definition.height) / 2;
    const modelRadiusClient = modelRadiusWorld * Math.max(clientPerWorldX, clientPerWorldY);
    // Keep SIZE shafts genuinely long for small solids while scaling them with larger models.
    // The visible endpoint is this distance from the true pivot; its hit path is the same shaft.
    const sizeBaseCss = Math.max(126, Math.min(300, modelRadiusClient * 0.78));
    const sizes: Record<Solid3DRotationAxis, number> = {
      rotationX: sizeBaseCss, rotationY: sizeBaseCss + 12, rotationZ: sizeBaseCss + 24,
    };
    // Large, comfortable rings surround even a tiny solid and keep a visible moat outside SIZE.
    // They are CSS-sized for grabability and expand from the true projected radius on large solids.
    const ringBaseCss = Math.max(174, Math.min(560, modelRadiusClient + 76));
    const ringRadii: Record<Solid3DRotationAxis, number> = {
      rotationX: ringBaseCss, rotationY: ringBaseCss + 22, rotationZ: ringBaseCss + 44,
    };
    const ringPointCount = 144;
    type AxisGeometry = {
      frame: (typeof frames)[number];
      directionClient: [number, number];
      sizeHandleClient: [number, number];
      sizeHandleNegativeClient: [number, number];
      sizeBasisClient: [number, number];
      sizeLabelClient: [number, number];
      planeUClient: [number, number];
      planeVClient: [number, number];
      ringPointsClient: [number, number][];
      ringFront: boolean[];
      ringLabelClient: [number, number];
      ringAngle: number;
    };
    const axisGeometries: AxisGeometry[] = frames.flatMap(frame => {
      const projected = axesById.get(frame.axis);
      if (!projected) return [];
      const axisIndex = SOLID_AXIS_KEYS[frame.axis];
      const screenDirection = toClientVector(projected.x, projected.y);
      const directionLength = Math.hypot(...screenDirection);
      const directionClient: [number, number] = directionLength > 1e-8
        ? [screenDirection[0] / directionLength, screenDirection[1] / directionLength]
        : [0, 0];
      const sizeBasisClient = toClientVector(projected.x * spans[axisIndex] * projectionScale,
        projected.y * spans[axisIndex] * projectionScale);
      const sizeHandleClient: [number, number] = [pivotClient[0] + directionClient[0] * sizes[frame.axis],
        pivotClient[1] + directionClient[1] * sizes[frame.axis]];
      const sizeHandleNegativeClient: [number, number] = [pivotClient[0] - directionClient[0] * sizes[frame.axis],
        pivotClient[1] - directionClient[1] * sizes[frame.axis]];
      const normal: [number, number] = [-directionClient[1], directionClient[0]];
      const sizeLabelClient: [number, number] = [sizeHandleClient[0] + directionClient[0] * 13 + normal[0] * 5,
        sizeHandleClient[1] + directionClient[1] * 13 + normal[1] * 5];

      // Build a complete ellipse/circle from the true transformed local rotation plane.
      // Only its presentation radius is normalized; every sample remains on this plane and
      // the same model-origin pivot, so the hit path and rotation gesture use the same geometry.
      const rawPlaneU = toClientVector(...projectSolid3DVector(frame.planeU));
      const rawPlaneV = toClientVector(...projectSolid3DVector(frame.planeV));
      let maximumStretch = 1e-8;
      for (let step = 0; step < 128; step++) {
        const angle = step * Math.PI * 2 / 128;
        maximumStretch = Math.max(maximumStretch, Math.hypot(
          rawPlaneU[0] * Math.cos(angle) + rawPlaneV[0] * Math.sin(angle),
          rawPlaneU[1] * Math.cos(angle) + rawPlaneV[1] * Math.sin(angle)));
      }
      const ringScale = ringRadii[frame.axis] / maximumStretch;
      const planeUClient: [number, number] = [rawPlaneU[0] * ringScale, rawPlaneU[1] * ringScale];
      const planeVClient: [number, number] = [rawPlaneV[0] * ringScale, rawPlaneV[1] * ringScale];
      const ringFront: boolean[] = [];
      const ringPointsClient = Array.from({ length: ringPointCount + 1 }, (_, index) => {
        const angle = index * Math.PI * 2 / ringPointCount;
        const cosine = Math.cos(angle), sine = Math.sin(angle);
        ringFront.push(solid3DCameraDepth([
          frame.planeU[0] * cosine + frame.planeV[0] * sine,
          frame.planeU[1] * cosine + frame.planeV[1] * sine,
          frame.planeU[2] * cosine + frame.planeV[2] * sine,
        ]) >= -1e-8);
        return [pivotClient[0] + planeUClient[0] * cosine + planeVClient[0] * sine,
          pivotClient[1] + planeUClient[1] * cosine + planeVClient[1] * sine] as [number, number];
      });
      return [{ frame, directionClient, sizeHandleClient, sizeHandleNegativeClient, sizeBasisClient, sizeLabelClient,
        planeUClient, planeVClient, ringPointsClient, ringFront,
        ringLabelClient: [pivotClient[0], pivotClient[1]] as [number, number], ringAngle: 0 }];
    });

    const sizePoints = axisGeometries.flatMap(axis => [axis.sizeHandleClient, axis.sizeHandleNegativeClient]);
    const sizeLabels = axisGeometries.map(axis => axis.sizeLabelClient);
    const sizeShaftSegments = axisGeometries.flatMap(axis => [
      [pivotClient, axis.sizeHandleClient] as const, [pivotClient, axis.sizeHandleNegativeClient] as const,
    ]);
    const pointDistance = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const pointSegmentDistance = (point: [number, number], a: [number, number], b: [number, number]) => {
      const vx = b[0] - a[0], vy = b[1] - a[1], length = vx * vx + vy * vy;
      const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / length)) : 0;
      return Math.hypot(point[0] - (a[0] + t * vx), point[1] - (a[1] + t * vy));
    };
    const pathDistance = (point: [number, number], axis: AxisGeometry) => {
      let distance = Number.POSITIVE_INFINITY;
      const points = axis.ringPointsClient;
      // Coarse every-fourth chords are sufficient for badge placement; drawing and hit-testing
      // continue to use the complete 144-segment ring.
      for (let index = 1; index < points.length; index += 4) {
        const end = Math.min(index + 3, points.length - 1);
        distance = Math.min(distance, pointSegmentDistance(point, points[index - 1], points[end]));
      }
      return distance;
    };
    const priorRingLabels: [number, number][] = [];
    for (const axis of axisGeometries) {
      let bestPoint = axis.ringPointsClient[0];
      let bestAngle = 0, bestScore = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < ringPointCount; index += 3) {
        const point = axis.ringPointsClient[index];
        let clearance = Number.POSITIVE_INFINITY;
        for (const other of axisGeometries) if (other !== axis)
          clearance = Math.min(clearance, pathDistance(point, other));
        for (const endpoint of sizePoints)
          clearance = Math.min(clearance, pointDistance(point, endpoint)
            - SOLID_ROTATE_LABEL_HIT_RADIUS - SOLID_SIZE_HIT_RADIUS);
        for (const [from, to] of sizeShaftSegments)
          clearance = Math.min(clearance, pointSegmentDistance(point, from, to)
            - SOLID_ROTATE_LABEL_HIT_RADIUS - SOLID_SIZE_SHAFT_HIT_RADIUS);
        for (const label of sizeLabels)
          clearance = Math.min(clearance, pointDistance(point, label) - SOLID_ROTATE_LABEL_HIT_RADIUS - 12);
        for (const label of priorRingLabels)
          clearance = Math.min(clearance, pointDistance(point, label) - SOLID_ROTATE_LABEL_HIT_RADIUS * 2 - 3);
        const viewportClearance = Math.min(point[0] - rect.left - 14, rect.right - 14 - point[0],
          point[1] - rect.top - 14, rect.bottom - 14 - point[1]);
        clearance = Math.min(clearance, viewportClearance);
        const score = clearance + (axis.ringFront[index] ? 5 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestPoint = point;
          bestAngle = index * Math.PI * 2 / ringPointCount;
        }
      }
      axis.ringLabelClient = [...bestPoint];
      axis.ringAngle = bestAngle;
      priorRingLabels.push(axis.ringLabelClient);
    }

    const axes = {} as Record<Solid3DRotationAxis, SolidAxisControl>;
    for (const axis of axisGeometries) {
      const { frame, directionClient, sizeHandleClient, sizeHandleNegativeClient, sizeLabelClient, sizeBasisClient,
        planeUClient, planeVClient, ringPointsClient, ringFront, ringLabelClient, ringAngle } = axis;
      const projected = axesById.get(frame.axis)!;
      axes[frame.axis] = {
        axis: frame.axis, label: frame.label, color: SOLID_GIZMO_COLORS[frame.axis], direction: frame.direction,
        planeU: frame.planeU, planeV: frame.planeV, cameraDepth: projected.cameraDepth,
        directionClient, sizeHandleClient, sizeHandleNegativeClient, sizeLabelClient, sizeBasisClient, planeUClient, planeVClient,
        ringPointsClient, ringFront, ringLabelClient, ringAngle, ringRadiusCss: ringRadii[frame.axis],
      };
    }

    const corners = projectedSolidWorldCorners(shape).map(([x, y]) => this.worldToClient(x, y));
    const frameClient = { minX: Math.min(...corners.map(point => point.x)),
      minY: Math.min(...corners.map(point => point.y)), maxX: Math.max(...corners.map(point => point.x)),
      maxY: Math.max(...corners.map(point => point.y)) };
    const modeWidth = SOLID_TOGGLE_WIDTH, modeHeight = 24, frameGap = 18;
    const viewport = rect;
    const frameCenterX = (frameClient.minX + frameClient.maxX) / 2;
    const frameCenterY = (frameClient.minY + frameClient.maxY) / 2;
    const controlPoints: [number, number][] = [
      ...(this.solidSizeEnabled ? [...sizePoints, ...sizeLabels] : []),
      ...(this.solidRotateEnabled ? axisGeometries.flatMap(axis => [...axis.ringPointsClient, axis.ringLabelClient]) : []),
    ];
    const controlTop = Math.min(frameClient.minY, ...controlPoints.map(point => point[1]));
    const controlBottom = Math.max(frameClient.maxY, ...controlPoints.map(point => point[1]));
    const aboveY = controlTop - modeHeight - frameGap;
    const belowY = controlBottom + frameGap;
    const candidatesByPriority = [
      [
        { x: frameCenterX - modeWidth / 2, y: aboveY },
        { x: frameClient.minX + frameGap, y: aboveY },
        { x: frameClient.maxX - modeWidth - frameGap, y: aboveY },
      ],
      [
        { x: frameCenterX - modeWidth / 2, y: belowY },
        { x: frameClient.minX + frameGap, y: belowY },
        { x: frameClient.maxX - modeWidth - frameGap, y: belowY },
      ],
    ];
    const rectDistance = (point: [number, number], box: { x: number; y: number; width: number; height: number }) => {
      const dx = Math.max(box.x - point[0], 0, point[0] - box.x - box.width);
      const dy = Math.max(box.y - point[1], 0, point[1] - box.y - box.height);
      return Math.hypot(dx, dy);
    };
    const rectCorners = (box: { x: number; y: number; width: number; height: number }): [number, number][] => [
      [box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height],
      [box.x, box.y + box.height],
    ];
    const segmentRectDistance = (a: [number, number], b: [number, number],
      box: { x: number; y: number; width: number; height: number }) => {
      if (a[0] >= box.x && a[0] <= box.x + box.width && a[1] >= box.y && a[1] <= box.y + box.height
        || b[0] >= box.x && b[0] <= box.x + box.width && b[1] >= box.y && b[1] <= box.y + box.height) return 0;
      const corners = rectCorners(box);
      return Math.min(...corners.map((corner, index) => segmentDistance(
        { x: a[0], y: a[1] }, { x: b[0], y: b[1] },
        { x: corner[0], y: corner[1] }, { x: corners[(index + 1) % corners.length][0],
          y: corners[(index + 1) % corners.length][1] })));
    };
    const viewportMargin = 4;
    const scoreCandidate = (position: { x: number; y: number }) => {
      const box = { ...position, width: modeWidth, height: modeHeight };
      const inViewport = box.x >= viewport.left + viewportMargin && box.y >= viewport.top + viewportMargin
        && box.x + box.width <= viewport.right - viewportMargin && box.y + box.height <= viewport.bottom - viewportMargin;
      if (!inViewport) return null;
      const clearances = [
        ...(this.solidSizeEnabled ? [
          ...sizePoints.map(point => rectDistance(point, box) - SOLID_SIZE_HIT_RADIUS),
          ...sizeLabels.map(point => rectDistance(point, box) - 14),
          ...sizeShaftSegments.map(([from, to]) => segmentRectDistance(from, to, box) - SOLID_SIZE_SHAFT_HIT_RADIUS),
        ] : []),
        ...(this.solidRotateEnabled ? axisGeometries.flatMap(axis => [
          ...axis.ringPointsClient.slice(1).map((point, index) =>
            segmentRectDistance(axis.ringPointsClient[index], point, box) - SOLID_ROTATE_ARC_HIT_RADIUS),
          rectDistance(axis.ringLabelClient, box) - SOLID_ROTATE_LABEL_HIT_RADIUS,
        ]) : []),
      ];
      return { ...box, clearance: clearances.length ? Math.min(...clearances) : 0 };
    };
    let candidates: Array<{ x: number; y: number; width: number; height: number; clearance: number }> = [];
    for (const group of candidatesByPriority) {
      const groupCandidates = group.map(scoreCandidate).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
      const clearCandidates = groupCandidates.filter(candidate => candidate.clearance >= 0);
      // Prefer a centered dock above the complete visible envelope; use below only when necessary,
      // and side placement only when neither vertical row fits in the live canvas viewport.
      if (clearCandidates.length) { candidates = [clearCandidates[0]]; break; }
      if (!candidates.length) candidates = groupCandidates;
    }
    // If both ideal rows are pushed beyond the viewport by an unusually large solid/ring set,
    // keep the dock above or below the selection and clamp it into view; never move it to a side.
    const clampX = (x: number) => Math.max(viewport.left + viewportMargin,
      Math.min(x, viewport.right - modeWidth - viewportMargin));
    const clampY = (y: number) => Math.max(viewport.top + viewportMargin,
      Math.min(y, viewport.bottom - modeHeight - viewportMargin));
    const dockAbove = frameCenterY > viewport.top + viewport.height / 2;
    const fallbackY = clampY(dockAbove ? aboveY : belowY);
    let chosen = candidates[0] ?? { x: clampX(frameCenterX - modeWidth / 2), y: fallbackY,
      width: modeWidth, height: modeHeight, clearance: Number.NEGATIVE_INFINITY };
    for (const candidate of candidates) if (candidate.clearance > chosen.clearance) chosen = candidate;
    const modeControlClient = { x: chosen.x, y: chosen.y, width: chosen.width, height: chosen.height };
    return { id: shape.id, pivotWorld, pivotClient, axes,
      sizeEnabled: this.solidSizeEnabled, rotateEnabled: this.solidRotateEnabled,
      modeControlClient, frameClient };
  }

  private hitSolidTransformControl(clientX: number, clientY: number): SolidTransformHit | null {
    if (this.sel.size !== 1) return null;
    const id = [...this.sel][0];
    const shape = this.shapes.get(id);
    if (shape?.type !== 'diagram' || !getShapeDefinition(shape.shapeId)?.solid3d) return null;
    const diagram = shape as DiagramShape;
    const basis = this.solidTransformBasis(diagram);
    if (!basis) return null;
    const { x, y, width, height } = basis.modeControlClient;
    if (clientX >= x && clientX <= x + width && clientY >= y && clientY <= y + height) {
      if (clientX < x + SOLID_SIZE_TOGGLE_WIDTH)
        return { id, kind: 'mode', mode: 'size', distance: 0 };
      if (clientX >= x + SOLID_SIZE_TOGGLE_WIDTH + SOLID_TOGGLE_GAP)
        return { id, kind: 'mode', mode: 'rotate', distance: 0 };
      return null;
    }

    const pointer = { x: clientX, y: clientY };
    const candidates: SolidTransformHit[] = [];
    const addArcHit = (control: SolidAxisControl) => {
      const labelDistance = Math.hypot(clientX - control.ringLabelClient[0], clientY - control.ringLabelClient[1]);
      if (labelDistance <= SOLID_ROTATE_LABEL_HIT_RADIUS)
        candidates.push({ id, kind: 'axis', mode: 'rotate', axis: control.axis, distance: labelDistance });
      let arcDistance = Number.POSITIVE_INFINITY;
      for (let index = 1; index < control.ringPointsClient.length; index++) {
        arcDistance = Math.min(arcDistance, pointToSegmentDistance(pointer,
          { x: control.ringPointsClient[index - 1][0], y: control.ringPointsClient[index - 1][1] },
          { x: control.ringPointsClient[index][0], y: control.ringPointsClient[index][1] }));
      }
      if (arcDistance <= SOLID_ROTATE_ARC_HIT_RADIUS)
        candidates.push({ id, kind: 'axis', mode: 'rotate', axis: control.axis, distance: arcDistance });
    };

    for (const control of Object.values(basis.axes)) {
      if (basis.sizeEnabled) {
        for (const directionSign of [1, -1] as const) {
          const endpoint = directionSign === 1 ? control.sizeHandleClient : control.sizeHandleNegativeClient;
          const distance = Math.hypot(clientX - endpoint[0], clientY - endpoint[1]);
          if (distance <= SOLID_SIZE_HIT_RADIUS)
            candidates.push({ id, kind: 'axis', mode: 'size', axis: control.axis, distance, directionSign });
          // The visible shaft is directly grabbable on either side of the shared pivot. Leave a
          // small central core unclaimed so converging X/Y/Z directions cannot steal each other's hit.
          const direction = [control.directionClient[0] * directionSign, control.directionClient[1] * directionSign];
          const shaftStart: [number, number] = [basis.pivotClient[0] + direction[0] * SOLID_SIZE_SHAFT_CORE_GAP,
            basis.pivotClient[1] + direction[1] * SOLID_SIZE_SHAFT_CORE_GAP];
          const vx = endpoint[0] - shaftStart[0], vy = endpoint[1] - shaftStart[1];
          const lengthSquared = vx * vx + vy * vy;
          const t = lengthSquared ? Math.max(0, Math.min(1,
            ((clientX - shaftStart[0]) * vx + (clientY - shaftStart[1]) * vy) / lengthSquared)) : 0;
          const shaftDistance = Math.hypot(clientX - shaftStart[0] - t * vx, clientY - shaftStart[1] - t * vy);
          if (shaftDistance <= SOLID_SIZE_SHAFT_HIT_RADIUS)
            candidates.push({ id, kind: 'axis', mode: 'size', axis: control.axis, distance: shaftDistance, directionSign });
        }
      }
      if (basis.rotateEnabled) addArcHit(control);
    }

    const axisOrder: Record<Solid3DRotationAxis, number> = { rotationX: 0, rotationY: 1, rotationZ: 2 };
    candidates.sort((a, b) => a.distance - b.distance
      || (a.kind === 'axis' ? axisOrder[a.axis] : 3) - (b.kind === 'axis' ? axisOrder[b.axis] : 3)
      || (a.kind === 'axis' && b.kind === 'axis' && a.mode !== b.mode ? (a.mode === 'size' ? -1 : 1) : 0));
    const nearest = candidates[0];
    const second = candidates[1];
    // A genuinely ambiguous overlap between distinct axes or modes is not a transform hit.
    // Visible size arrows and rotation arcs are separately spaced; this guard prevents an
    // invisible tie-break from stealing a gesture when two active controls are almost equidistant.
    if (nearest && second && nearest.kind === 'axis' && second.kind === 'axis'
      && (nearest.mode !== second.mode || nearest.axis !== second.axis)
      && second.distance - nearest.distance < SOLID_HIT_AMBIGUITY_DISTANCE) return null;
    return nearest ?? null;
  }

  private rotationGestureAngle(gesture: ActiveSolidTransform, clientX: number, clientY: number): number {
    const dx = clientX - gesture.pivotClient[0], dy = clientY - gesture.pivotClient[1];
    const determinant = gesture.planeUClient[0] * gesture.planeVClient[1]
      - gesture.planeUClient[1] * gesture.planeVClient[0];
    if (gesture.degeneratePlane || Math.abs(determinant) < 1e-7) {
      const polar = Math.atan2(dy, dx);
      return gesture.axis === 'rotationX' ? polar : -polar;
    }
    const u = (dx * gesture.planeVClient[1] - dy * gesture.planeVClient[0]) / determinant;
    const v = (gesture.planeUClient[0] * dy - gesture.planeUClient[1] * dx) / determinant;
    return Math.atan2(v, u);
  }

  private beginSolidTransform(hit: SolidTransformHit, event: PointerEvent) {
    const shape = this.shapes.get(hit.id);
    if (hit.kind === 'mode') {
      if (shape?.type !== 'diagram') return;
      // Enabling one layer atomically replaces the other; disabling the active layer leaves
      // both controls off. The single `solidTransformMode` field can never represent BOTH.
      if (hit.mode === 'size') this.solidSizeEnabled = !this.solidSizeEnabled;
      else this.solidRotateEnabled = !this.solidRotateEnabled;
      this.hoveredSolidControl = hit;
      this.onCursor?.('pointer');
      this.dirty = true;
      return;
    }
    if (shape?.type !== 'diagram') return;
    const original = JSON.parse(JSON.stringify(shape)) as DiagramShape;
    const basis = this.solidTransformBasis(original);
    const axisControl = basis?.axes[hit.axis];
    if (!basis || !axisControl) return;
    const determinant = axisControl.planeUClient[0] * axisControl.planeVClient[1]
      - axisControl.planeUClient[1] * axisControl.planeVClient[0];
    const gesture: ActiveSolidTransform = {
      id: original.id, mode: hit.mode, axis: hit.axis, original,
      startClient: [event.clientX, event.clientY], pivotClient: [...basis.pivotClient],
      sizeBasisClient: [...axisControl.sizeBasisClient],
      sizeGroup: solid3DSizeGroup(getShapeDefinition(original.shapeId)!.geometry as Solid3DGeometry,
        SOLID_AXIS_NAMES[hit.axis]),
      sizeDirectionSign: hit.directionSign ?? 1,
      planeUClient: [...axisControl.planeUClient], planeVClient: [...axisControl.planeVClient],
      degeneratePlane: Math.abs(determinant) < 1e-7, previousAngle: 0, totalAngle: 0,
    };
    if (hit.mode === 'rotate') gesture.previousAngle = this.rotationGestureAngle(gesture, event.clientX, event.clientY);
    this.saveH();
    this.solidTransformGesture = gesture;
    this.isSizing3D = hit.mode === 'size';
    this.isRotating3D = hit.mode === 'rotate';
    this.activePointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    this.hoveredSolidControl = hit;
    this.onCursor?.('grabbing');
    this.dirty = true;
  }

  private doResizeSolid3D(clientX: number, clientY: number) {
    const gesture = this.solidTransformGesture;
    if (!gesture || gesture.mode !== 'size') return;
    const basis = gesture.sizeBasisClient;
    const lengthSquared = basis[0] * basis[0] + basis[1] * basis[1];
    if (!(lengthSquared > 1e-8)) return;
    const pointerDelta: [number, number] = [clientX - gesture.startClient[0], clientY - gesture.startClient[1]];
    // Orthogonally project pointer travel onto the selected local axis's true screen derivative.
    const scaleDelta = gesture.sizeDirectionSign
      * (pointerDelta[0] * basis[0] + pointerDelta[1] * basis[1]) / lengthSquared;
    const definition = getShapeDefinition(gesture.original.shapeId);
    if (!definition?.solid3d) return;
    const geometry = definition.geometry as Solid3DGeometry;
    const initial = normalizeSolid3DScale(geometry, gesture.original.scale3d ?? definition.defaultScale3d
      ?? solid3DScaleFromBounds(gesture.original.w, gesture.original.h, definition.width, definition.height, geometry));
    const key = SOLID_AXIS_NAMES[gesture.axis];
    const value = Math.max(0.01, Math.min(64, initial[key] + scaleDelta));
    const next: Solid3DScale = { ...initial };
    gesture.sizeGroup.forEach(axis => { next[axis] = value; });
    const scale3d = normalizeSolid3DScale(geometry, next);
    const beforeBounds = localSolidProjectedBounds(gesture.original);
    const afterBounds = localSolidProjectedBounds({ ...gesture.original, scale3d });
    const beforeWidth = Math.max(1, beforeBounds.maxX - beforeBounds.minX);
    const beforeHeight = Math.max(1, beforeBounds.maxY - beforeBounds.minY);
    const afterWidth = Math.max(1, afterBounds.maxX - afterBounds.minX);
    const afterHeight = Math.max(1, afterBounds.maxY - afterBounds.minY);
    const embeddedTextScale = resizeDiagramEmbeddedTextScale({ ...gesture.original, w: beforeWidth, h: beforeHeight },
      afterWidth, afterHeight);
    this.put({ ...gesture.original, scale3d, embeddedTextScale });
  }

  private doRotateSolid3D(clientX: number, clientY: number) {
    const gesture = this.solidTransformGesture;
    if (!gesture || gesture.mode !== 'rotate') return;
    const angle = this.rotationGestureAngle(gesture, clientX, clientY);
    let delta = angle - gesture.previousAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (!Number.isFinite(delta)) return;
    gesture.previousAngle = angle;
    gesture.totalAngle += delta;
    const orientation = rotateSolid3DOrientationAboutLocalAxis(gesture.original.params ?? {}, gesture.axis,
      gesture.totalAngle);
    this.put({ ...gesture.original, params: { ...(gesture.original.params ?? {}), ...orientation } });
  }

  private drawSolidTransformControls(shape: DiagramShape, basis: SolidTransformBasis) {
    const cx = this.cx;
    const viewport = this.cv.getBoundingClientRect();
    const scaleX = this.cv.width > 0 ? this.cv.width / Math.max(1, viewport.width) : 1;
    const scaleY = this.cv.height > 0 ? this.cv.height / Math.max(1, viewport.height) : 1;
    const px = (clientX: number) => clientX - viewport.left;
    const py = (clientY: number) => clientY - viewport.top;
    cx.save();
    cx.resetTransform();
    cx.scale(scaleX, scaleY);
    const pivot: [number, number] = [px(basis.pivotClient[0]), py(basis.pivotClient[1])];
    const toggleRect = { x: px(basis.modeControlClient.x), y: py(basis.modeControlClient.y),
      width: basis.modeControlClient.width, height: basis.modeControlClient.height };
    const hovered = this.hoveredSolidControl;
    const active = this.solidTransformGesture;
    const axisHot = (mode: SolidTransformMode, axis: Solid3DRotationAxis) => {
      if (active?.id === shape.id && active.mode === mode && active.axis === axis) return true;
      return hovered?.id === shape.id && hovered.kind === 'axis' && hovered.mode === mode && hovered.axis === axis;
    };
    const toggleHot = (mode: SolidTransformMode) => hovered?.id === shape.id
      && hovered.kind === 'mode' && hovered.mode === mode;
    const drawRoundRect = (x: number, y: number, width: number, height: number, radius: number) => {
      cx.beginPath();
      if (typeof cx.roundRect === 'function') cx.roundRect(x, y, width, height, radius);
      else {
        cx.moveTo(x + radius, y); cx.lineTo(x + width - radius, y); cx.quadraticCurveTo(x + width, y, x + width, y + radius);
        cx.lineTo(x + width, y + height - radius); cx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        cx.lineTo(x + radius, y + height); cx.quadraticCurveTo(x, y + height, x, y + height - radius);
        cx.lineTo(x, y + radius); cx.quadraticCurveTo(x, y, x + radius, y); cx.closePath();
      }
    };
    const drawArrowhead = (point: [number, number], direction: [number, number], color: string,
      hot: boolean, size = 8, hollow = false) => {
      const length = Math.max(1e-6, Math.hypot(...direction));
      const ux = direction[0] / length, uy = direction[1] / length;
      const pxv = -uy, pyv = ux;
      const base: [number, number] = [point[0] - ux * size, point[1] - uy * size];
      cx.beginPath(); cx.moveTo(point[0], point[1]);
      cx.lineTo(base[0] + pxv * size * 0.56, base[1] + pyv * size * 0.56);
      cx.lineTo(base[0] - pxv * size * 0.56, base[1] - pyv * size * 0.56);
      cx.closePath();
      if (!hollow) { cx.fillStyle = hot ? color : '#ffffff'; cx.fill(); }
      cx.strokeStyle = color; cx.lineWidth = hot ? 2.1 : 1.7; cx.stroke();
    };
    const drawAxisLabel = (label: string, point: [number, number], color: string, hot: boolean, fontSize = 10) => {
      cx.font = `${hot ? '800' : '700'} ${fontSize}px Inter, Segoe UI, sans-serif`;
      cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.lineJoin = 'round';
      cx.lineWidth = 3.6; cx.strokeStyle = 'rgba(255,255,255,.96)'; cx.strokeText(label, point[0], point[1]);
      cx.fillStyle = hot ? color : `${color}e8`; cx.fillText(label, point[0], point[1]);
    };

    // Large ROTATE rings are painted first. Each complete circle is a sampled projection of the
    // true local rotation plane about the model origin; rear halves are dashed and readable front
    // halves are solid. White keylines preserve contrast over transparent faces and blue frames.
    if (basis.rotateEnabled) {
      for (const control of Object.values(basis.axes)) {
        const hot = axisHot('rotate', control.axis);
        const points = control.ringPointsClient;
        for (const frontSide of [false, true]) {
          const ringOpacity = hot ? 0.96 : frontSide ? 0.78 : 0.58;
          cx.beginPath();
          for (let index = 1; index < points.length; index++) {
            const front = control.ringFront[index - 1] || control.ringFront[index];
            if (front !== frontSide) continue;
            cx.moveTo(px(points[index - 1][0]), py(points[index - 1][1]));
            cx.lineTo(px(points[index][0]), py(points[index][1]));
          }
          cx.lineCap = 'round'; cx.lineJoin = 'round';
          cx.setLineDash(frontSide ? [] : [7, 5]);
          cx.strokeStyle = frontSide ? 'rgba(255,255,255,.72)' : 'rgba(255,255,255,.50)';
          cx.lineWidth = hot ? 7.2 : frontSide ? 5.4 : 4.6; cx.stroke();
          cx.beginPath();
          for (let index = 1; index < points.length; index++) {
            const front = control.ringFront[index - 1] || control.ringFront[index];
            if (front !== frontSide) continue;
            cx.moveTo(px(points[index - 1][0]), py(points[index - 1][1]));
            cx.lineTo(px(points[index][0]), py(points[index][1]));
          }
          cx.globalAlpha = ringOpacity;
          cx.strokeStyle = control.color;
          cx.lineWidth = hot ? (frontSide ? 3.8 : 3.1) : (frontSide ? 2.9 : 2.4);
          cx.setLineDash(frontSide ? [] : [7, 5]); cx.stroke();
          cx.globalAlpha = 1;
          cx.setLineDash([]);
        }
        const label: [number, number] = [px(control.ringLabelClient[0]), py(control.ringLabelClient[1])];
        cx.beginPath(); cx.arc(label[0], label[1], 10.5, 0, Math.PI * 2);
        cx.fillStyle = 'rgba(255,255,255,.98)'; cx.fill();
        cx.strokeStyle = control.color; cx.lineWidth = hot ? 2.4 : 1.8; cx.stroke();
        drawAxisLabel(control.label, label, control.color, hot, 11.5);
      }
    }

    if (basis.sizeEnabled) {
      for (const control of Object.values(basis.axes)) {
        const hot = axisHot('size', control.axis);
        const positive: [number, number] = [px(control.sizeHandleClient[0]), py(control.sizeHandleClient[1])];
        const negative: [number, number] = [px(control.sizeHandleNegativeClient[0]), py(control.sizeHandleNegativeClient[1])];
        const direction = control.directionClient;
        // Long, thin SIZE axes share the model origin. Soft keylines preserve legibility,
        // while a modest color alpha keeps the geometry visually primary.
        cx.beginPath(); cx.moveTo(negative[0], negative[1]); cx.lineTo(positive[0], positive[1]);
        cx.strokeStyle = 'rgba(255,255,255,.72)'; cx.lineWidth = hot ? 6.8 : 5.4; cx.lineCap = 'round'; cx.stroke();
        cx.beginPath(); cx.moveTo(negative[0], negative[1]); cx.lineTo(positive[0], positive[1]);
        cx.globalAlpha = hot ? 0.96 : 0.80;
        cx.strokeStyle = control.color; cx.lineWidth = hot ? 3.8 : 2.9;
        cx.lineCap = 'round'; cx.stroke(); cx.globalAlpha = 1;
        drawArrowhead(positive, direction, control.color, hot, hot ? 13 : 11.5);
        drawArrowhead(negative, [-direction[0], -direction[1]], control.color, hot, hot ? 11 : 9.5, true);
        const label: [number, number] = [px(control.sizeLabelClient[0]), py(control.sizeLabelClient[1])];
        drawAxisLabel(control.label, label, control.color, hot, 12.2);
      }
    }

    // All visual and interactive layers share the exact projected model origin; toggling either
    // layer never offsets or hides the anchor mark.
    cx.beginPath(); cx.arc(pivot[0], pivot[1], 4.2, 0, Math.PI * 2);
    cx.fillStyle = '#ffffff'; cx.fill(); cx.strokeStyle = '#2563eb'; cx.lineWidth = 2; cx.stroke();

    // Two independent compact toggle buttons replace the former mutually-exclusive segmented tab.
    const buttons: Array<{ mode: SolidTransformMode; label: string; x: number; width: number; enabled: boolean }> = [
      { mode: 'size', label: 'SIZE', x: toggleRect.x, width: SOLID_SIZE_TOGGLE_WIDTH, enabled: basis.sizeEnabled },
      { mode: 'rotate', label: 'ROTATE', x: toggleRect.x + SOLID_SIZE_TOGGLE_WIDTH + SOLID_TOGGLE_GAP,
        width: SOLID_ROTATE_TOGGLE_WIDTH, enabled: basis.rotateEnabled },
    ];
    buttons.forEach(button => {
      drawRoundRect(button.x, toggleRect.y, button.width, toggleRect.height, 8);
      cx.fillStyle = button.enabled ? 'rgba(219,234,254,.98)' : 'rgba(255,255,255,.97)'; cx.fill();
      cx.strokeStyle = toggleHot(button.mode) ? '#2563eb' : 'rgba(51,65,85,.42)';
      cx.lineWidth = toggleHot(button.mode) ? 1.35 : 0.9; cx.stroke();
      cx.fillStyle = button.enabled ? '#1d4ed8' : '#475569';
      cx.font = `${button.enabled ? '700' : '600'} 9.5px Inter, Segoe UI, sans-serif`;
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(button.label, button.x + button.width / 2, toggleRect.y + toggleRect.height / 2 + 0.2);
    });
    cx.restore();
  }

  // Registered box objects expose transformed resize handles; connectors expose endpoints/waypoints.
  private hitResizeHandle(cx: number, cy: number): { id: string; h: string } | null {
    const radius = 9;
    const hit = (wx: number, wy: number) => {
      const screen = this.worldToClient(wx, wy);
      return Math.hypot(cx - screen.x, cy - screen.y) <= radius;
    };
    for (const shape of this.shapes.values()) {
      if (!this.sel.has(shape.id)) continue;
      if (shape.type === 'connector') {
        const connector = shape as ConnectorShape;
        const definition = getShapeDefinition(connector.shapeId);
        const capabilities = diagramCapabilitiesFor(definition, this.getSemanticContextForShape(connector.id));
        if (hit(connector.x1, connector.y1)) return { id: shape.id, h: 'line-start' };
        if (hit(connector.x2, connector.y2)) return { id: shape.id, h: 'line-end' };
        if (capabilities.connector?.routeEditable !== false) for (let index = 0; index < connector.waypoints.length; index++) {
          const [x, y] = connector.waypoints[index];
          if (hit(x, y)) return { id: shape.id, h: `waypoint-${index}` };
        }
        if (capabilities.transform.rotate && hasConnectorRotationHandle(connector)) {
          const rotationHandle = { x: (shape.minX + shape.maxX) / 2, y: shape.minY - 24 / this.cam.zoom };
          if (hit(rotationHandle.x, rotationHandle.y)) return { id: shape.id, h: 'rotate' };
        }
        for (const label of this.connectorLabelVisuals(connector)) {
          if (!label.positionEditable || !hit(label.x, label.y)) continue;
          const handle = label.kind === 'source' ? 'source-label-position'
            : label.kind === 'target' ? 'target-label-position' : 'label-position';
          return { id: shape.id, h: handle };
        }
        continue;
      }
      if (shape.type === 'line' || shape.type === 'arrow') {
        const line = shape as LineShape | ArrowShape;
        if (hit(line.x1, line.y1)) return { id: shape.id, h: 'line-start' };
        if (hit(line.x2, line.y2)) return { id: shape.id, h: 'line-end' };
        continue;
      }
      if (!('x' in shape && 'w' in shape)) continue;
      const box = shape as BoxShape;
      const diagramDefinition = box.type === 'diagram' ? getShapeDefinition((box as DiagramShape).shapeId) : undefined;
      const solidShape = box.type === 'diagram' && diagramDefinition?.solid3d ? box as DiagramShape : null;
      // 3D solids use local-axis SIZE/ROTATE layers; never expose generic 2D resize handles.
      if (solidShape) continue;
      const capabilities = diagramCapabilitiesFor(diagramDefinition);
      for (const [handle, x, y] of getNotationResizeHandles(box, capabilities))
        if (hit(x, y)) return { id: shape.id, h: handle };
      if (capabilities.transform.rotate) {
        const [rotateX, rotateY] = getRotationHandlePoint(box, this.cam.zoom);
        if (hit(rotateX, rotateY)) return { id: shape.id, h: 'rotate' };
      }
    }
    return null;
  }

  private doResize(wx: number, wy: number) {
    if (!this.resizeRef) return;
    const original = this.resizeRef.s;
    const dx = wx - this.resizeRef.wx, dy = wy - this.resizeRef.wy;
    if (original.type === 'connector') {
      const connector = original as ConnectorShape;
      const current = this.shapes.get(connector.id) as ConnectorShape;
      if (this.resizeH === 'label-position' || this.resizeH === 'source-label-position' || this.resizeH === 'target-label-position') {
        const definition = getShapeDefinition(connector.shapeId);
        const connectorCaps = diagramCapabilitiesFor(definition, this.getSemanticContextForShape(connector.id)).connector;
        const side = this.resizeH === 'source-label-position' ? 'source'
          : this.resizeH === 'target-label-position' ? 'target' : 'center';
        if (connectorCaps?.labelPositionEditable !== true
          || (side === 'source' && connectorCaps.sourceLabelEditable !== true)
          || (side === 'target' && connectorCaps.targetLabelEditable !== true)) return;
        const labelPlacement = connectorLabelPlacementAtPoint(getConnectorRoute(current), [wx, wy]);
        if (!labelPlacement) return;
        const isUmlRelationship = definition?.semantic?.family === 'uml.relationship-edge'
          || definition?.semantic?.family === 'uml.usecase-dependency';
        const baseOffset = labelPlacement.labelOffset - parallelConnectorLabelOffset(0, current.parallelLane, isUmlRelationship);
        const next = side === 'source'
          ? { ...current, sourceLabelPosition: labelPlacement.labelPosition, sourceLabelOffset: baseOffset }
          : side === 'target'
            ? { ...current, targetLabelPosition: labelPlacement.labelPosition, targetLabelOffset: baseOffset }
            : { ...current, labelPosition: labelPlacement.labelPosition, labelOffset: baseOffset };
        this.put({ ...next, ...connectorBounds(next) }, { syncAttachments: false });
      } else if (this.resizeH === 'rotate') {
        const cx = (connector.minX + connector.maxX) / 2, cy = (connector.minY + connector.maxY) / 2;
        const a0 = Math.atan2(this.resizeRef.wy - cy, this.resizeRef.wx - cx);
        const a1 = Math.atan2(wy - cy, wx - cx), angle = (a1 - a0) * 180 / Math.PI;
        const centerX = (connector.x1 + connector.x2) / 2, centerY = (connector.y1 + connector.y2) / 2;
        const [rotatedX1, rotatedY1] = rotatePoint(connector.x1, connector.y1, centerX, centerY, angle);
        const [rotatedX2, rotatedY2] = rotatePoint(connector.x2, connector.y2, centerX, centerY, angle);
        const waypoints = connector.waypoints.map(([x, y]) => rotatePoint(x, y, centerX, centerY, angle));
        const next = { ...connector,
          x1: connector.sourceRef ? connector.x1 : rotatedX1, y1: connector.sourceRef ? connector.y1 : rotatedY1,
          x2: connector.targetRef ? connector.x2 : rotatedX2, y2: connector.targetRef ? connector.y2 : rotatedY2,
          waypoints };
        this.put({ ...next, ...connectorBounds(next) }, { syncAttachments: false });
      } else if (this.resizeH === 'line-start' || this.resizeH === 'line-end') {
        const start = this.resizeH === 'line-start';
        const side: EndpointSide = start ? 'source' : 'target';
        const invalidEndpointRefs = { ...(current.invalidEndpointRefs ?? {}) };
        delete invalidEndpointRefs[side];
        const next = { ...current,
          x1: connector.x1 + (start ? dx : 0), y1: connector.y1 + (start ? dy : 0),
          x2: connector.x2 + (start ? 0 : dx), y2: connector.y2 + (start ? 0 : dy),
          ...(start ? { sourceRef: undefined, sourceIntent: 'pending' as EndpointIntent }
            : { targetRef: undefined, targetIntent: 'pending' as EndpointIntent }),
          invalidEndpointRefs: Object.keys(invalidEndpointRefs).length ? invalidEndpointRefs : undefined,
        };
        const updated = { ...next, ...connectorBounds(next) };
        this.put(updated, { syncAttachments: false });
        this.updateConnectorTargetFeedback(updated, start ? updated.x1 : updated.x2,
          start ? updated.y1 : updated.y2, side);
      } else if (this.resizeH.startsWith('waypoint-')) {
        const index = Number(this.resizeH.slice('waypoint-'.length));
        if (!Number.isInteger(index) || index < 0 || index >= connector.waypoints.length) return;
        const waypoints = current.waypoints.map(point => [point[0], point[1]] as [number, number]);
        waypoints[index] = [connector.waypoints[index][0] + dx, connector.waypoints[index][1] + dy];
        const next = { ...current, waypoints };
        this.put({ ...next, ...connectorBounds(next) });
      }
      return;
    }
    if (original.type === 'line' || original.type === 'arrow') {
      const line = original as LineShape | ArrowShape;
      if (this.resizeH !== 'line-start' && this.resizeH !== 'line-end') return;
      const start = this.resizeH === 'line-start';
      const x1 = line.x1 + (start ? dx : 0), y1 = line.y1 + (start ? dy : 0);
      const x2 = line.x2 + (start ? 0 : dx), y2 = line.y2 + (start ? 0 : dy);
      this.put({ ...line, x1, y1, x2, y2, minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) } as AnyShape);
      return;
    }
    if (!isPositionedShape(original)) return;
    const box = original;
    const definition = box.type === 'diagram' ? getShapeDefinition((box as DiagramShape).shapeId) : getShapeDefinitionForLegacyType(box.type);
    const capabilities = diagramCapabilitiesFor(definition);
    if (this.resizeH === 'rotate') {
      if (!capabilities.transform.rotate) return;
      const centerX = box.x + box.w / 2, centerY = box.y + box.h / 2;
      const initial = Math.atan2(this.resizeRef.wy - centerY, this.resizeRef.wx - centerX);
      const nextAngle = Math.atan2(wy - centerY, wx - centerX);
      const rotation = (box.rotation ?? 0) + (nextAngle - initial) * 180 / Math.PI;
      this.put(withComputedShapeBounds({ ...box, rotation } as AnyShape));
      return;
    }
    let minWidth = box.type === 'sticky' ? 120 : 20;
    let minHeight = box.type === 'sticky' ? 120 : box.type === 'code' ? initialCodeBlockHeight(box.fs) : 20;
    if (box.type === 'diagram') {
      const contentMinimum = this.diagramContentMinimumSize(box as DiagramShape);
      if (contentMinimum) { minWidth = Math.max(minWidth, contentMinimum.width); minHeight = Math.max(minHeight, contentMinimum.height); }
    }
    if (!getNotationResizeHandles(box, capabilities).some(([handle]) => handle === this.resizeH)) return;
    const resizedGeometry = resizeBoxFromHandle(box, this.resizeH, { x: wx, y: wy },
      getNotationResizePolicy(definition, capabilities), minWidth, minHeight);
    if (!resizedGeometry) return;
    const autoHeightHandles = ['nw', 'ne', 'sw', 'se', 'n', 's'];
    if (box.type === 'code' && autoHeightHandles.includes(this.resizeH)) {
      this.put(withComputedShapeBounds({ ...box, ...resizedGeometry, autoHeight: false }));
    } else {
      const hasOwnedDiagramLabel = definition?.kind === 'shape';
      const resizedShape = withComputedShapeBounds({
        ...box,
        ...resizedGeometry,
        ...(hasOwnedDiagramLabel ? { embeddedTextScale: resizeDiagramEmbeddedTextScale(box,
          resizedGeometry.w, resizedGeometry.h) } : {}),
      } as AnyShape);
      if (box.type === 'diagram' && definition?.semantic?.container
        && !this.containerResizeAllowed(box as DiagramShape, resizedShape as DiagramShape)) return;
      let committedShape = resizedShape;
      if (box.type === 'diagram' && box.shapeId === 'uml.activation')
        committedShape = this.sequenceControlWithTemporalMetadata(resizedShape as DiagramShape, true, true);
      this.put(committedShape);
      if (box.type === 'diagram' && box.shapeId === 'uml.destroy'
        && committedShape.type === 'diagram' && committedShape.containerId) {
        const parent = this.shapes.get(committedShape.containerId);
        if (parent?.type === 'diagram') this.synchronizeSequenceDestruction(parent as DiagramShape);
      }
    }
  }


  // ─── zoom ────────────────────────────────────────────────────────────────
  zoomAt(clientX: number, clientY: number, factor: number) {
    const anchor = this.clientToWorld(clientX, clientY);
    const nextZoom = Math.max(0.04, Math.min(16, this.cam.zoom * factor));
    const zoomRatio = this.cam.zoom / nextZoom;
    const nextX = anchor.x - (anchor.x - this.cam.x) * zoomRatio;
    const nextY = anchor.y - (anchor.y - this.cam.y) * zoomRatio;
    this.setCamera(nextX, nextY, nextZoom);
  }

  setCamera(x:number, y:number, zoom:number) {
    this.cam = {x,y,zoom};
    this.onZoom?.(zoom);
    this.onCam?.(this.cam);
    this.onCameraChange?.(this.cam);
    this.notifyCameraFrame();
    this.dirty = true;
  }

  panBy(dx: number, dy: number) {
    this.setCamera(this.cam.x+dx/this.cam.zoom, this.cam.y+dy/this.cam.zoom, this.cam.zoom);
  }

  panTo(worldX: number, worldY: number) {
    this.setCamera(worldX, worldY, this.cam.zoom);
  }

  // ─── public API ──────────────────────────────────────────────────────────
  private cursorForTool(): string {
    if (this.tool === 'select') return 'default';
    if (this.tool === 'text' || this.tool === 'math' || this.tool === 'code') return 'text';
    if (this.tool === 'sticky') return 'default';
    if (this.tool === 'eraser') return 'default';
    if (this.tool === 'lasso-select' || this.tool === 'pen' || isBoxShapeTool(this.tool) || this.tool === 'arrow') return 'crosshair';
    if (this.tool === 'image') return 'copy';
    return 'default';
  }

  setPenMode(mode: 'normal' | 'smart') {
    this.penMode = mode;
  }

  setTool(t: ToolType, preserveSelection: boolean = false) {
    // Hidden catalogue entries stay resolvable for old saved shapes, but cannot be armed as a
    // new drawing tool through stale local state, shortcuts, or programmatic callers.
    if (getShapeDefinitionByToolId(t)?.pickerVisible === false) t = 'select';
    if (t !== this.tool && (this.isDown || this.isPanning || this.isDragging || this.isResizing
      || this.isSizing3D || this.isRotating3D || this.isBoxing || this.isLassoing)) {
      this.cancelPointer();
    }
    this.tool = t;
    if (t !== 'select' && t !== 'lasso-select') {
      this.previousCreationTool = t;
    } else {
      this.previousCreationTool = null;
    }
    this.connectorTargetFeedback = null;
    this.connectorSourceFeedback = null;
    this.hoveredSolidControl = null;
    if (t !== 'eraser') this.eraserCursorPoint = null;
    if (!preserveSelection) {
      this.sel.clear(); this.onSel?.([]);
    }
    this.dirty = true;
    this.onCursor?.(this.cursorForTool());
  }

  public clearSelection() {
    this.sel.clear();
    this.onSel?.([]);
    this.previousCreationTool = null;
    this.dirty = true;
  }

  /** End any transient pointer gesture safely on pointercancel, lost focus, tool switch, or teardown. */
  cancelPointer(event?: PointerEvent) {
    if (event && this.activePointerId !== null && Number.isFinite(event.pointerId) && event.pointerId !== this.activePointerId) return;
    if (this.isErasing) this.finishErasing();
    if (this.isPanning) {
      this.isPanning = false;
      this.panButton = null;
      this.onCameraChange?.(this.cam);
      this.onCam?.(this.cam);
    }
    if (this.solidTransformGesture) this.put(this.solidTransformGesture.original);
    if (this.isResizing && this.resizeRef?.s) this.put(this.resizeRef.s as AnyShape);
    if (this.isDragging) {
      for (const origin of this.dragShapeOrigins.values()) this.put(origin);
      this.dragOrigins.forEach((_, id) => {
        const current = this.shapes.get(id);
        if (current && isConnectableShape(current)) this.updateAttachedConnectors(id);
      });
    }
    if (this.currId) {
      let shape = this.shapes.get(this.currId);
      if (shape?.type === 'pen' && event) {
        this.appendPenSamples(event, true);
        shape = this.shapes.get(this.currId);
      }
      if (shape?.type === 'pen' && !this.activeSmartDrawing) this.flushPenPublish();
      if (shape?.type === 'pen' && this.activeSmartDrawing) {
        // Cancellation is never a recognition signal: publish the original sampled ink.
        this.put(shape, {persist:true});
      }
      this.currId = null;
      this.solidCreationGesture = null;
      this.activeSmartDrawing = false;
      this.isDown = false;
      this.saveH();
    }
    if (this.isDragging || this.isResizing || this.isSizing3D || this.isRotating3D) this.saveH();
    if (this.pendingPenPublishRaf !== null) {
      cancelAnimationFrame(this.pendingPenPublishRaf);
      this.pendingPenPublishRaf = null;
    }
    this.isDown = false;
    this.solidCreationGesture = null;
    this.connectorTargetFeedback = null;
    this.connectorSourceFeedback = null;
    this.activePointerId = null;
    this.isDragging = false;
    this.isResizing = false;
    this.isSizing3D = false;
    this.isRotating3D = false;
    this.solidTransformGesture = null;
    this.hoveredSolidControl = null;
    this.connectorTargetFeedback = null;
    this.dragOrigins.clear(); this.dragShapeOrigins.clear();
    this.resizeH = '';
    this.resizeRef = null;
    this.isBoxing = false;
    this.isLassoing = false;
    this.lassoPts = [];
    this.eraserLastPoint = null;
    this.onCursor?.(this.cursorForTool());
    this.dirty = true;
  }

  selectAll(): string[] {
    // Every deserialized supported board object participates, whether its pixels come from the
    // canvas renderer or a DOM overlay. Do not viewport-filter this operation.
    const ids = [...this.shapes.keys()];
    this.sel.clear();
    ids.forEach(id => this.sel.add(id));
    if (this.tool !== 'select') {
      this.tool = 'select';
      this.onTool?.('select');
    }
    this.onSel?.(ids);
    this.onCursor?.(this.cursorForTool());
    this.dirty = true;
    return ids;
  }

  deleteSel() {
    if (this.isReadOnly) return;
    this.deleteShapes([...this.sel]);
    this.clearSelection();
    this.saveH();
  }

  dupSel() {
    if (this.isReadOnly) return;
    const originalById = new Map<string, AnyShape>();
    const selected = [...this.sel].map(id => this.shapes.get(id)).filter((shape): shape is AnyShape => Boolean(shape));
    const add = (shape: AnyShape | undefined) => { if (shape) originalById.set(shape.id, shape); };
    selected.forEach(add);
    for (const shape of selected) if (shape.type === 'diagram'
      && getShapeDefinition(shape.shapeId)?.semantic?.family === 'uml.sequence-control' && shape.containerId) {
      add(this.shapes.get(shape.containerId));
    }
    // A selected semantic container is an explicit subgraph selection: include all owned nodes
    // and connectors, not just the frame's pixels.
    for (const shape of selected) if (shape.type === 'diagram') {
      const definition = getShapeDefinition(shape.shapeId);
      if (definition?.semantic?.container) {
        this.containedDescendants(shape.id).forEach(add);
        this.containedConnectorDescendants(shape.id).forEach(add);
      }
    }
    // Duplicating an edge as a semantic object includes its endpoint nodes so no cloned connector
    // can silently continue pointing at the originals.
    for (const shape of selected) if (shape.type === 'connector') {
      for (const reference of [shape.sourceRef, shape.targetRef]) {
        if (!reference) continue;
        const endpoint = this.shapes.get(reference.shapeId);
        add(endpoint);
        if (endpoint?.type === 'diagram' && getShapeDefinition(endpoint.shapeId)?.semantic?.family === 'uml.sequence-control'
          && endpoint.containerId) add(this.shapes.get(endpoint.containerId));
      }
    }
    const copiedNodeIds = new Set([...originalById.values()].filter(isConnectableShape).map(shape => shape.id));
    // Include all edges internal to the selected semantic node set. Edges with an external end
    // remain outside the copied graph unless the edge itself was explicitly selected.
    for (const shape of this.shapes.values()) if (shape.type === 'connector') {
      const connector = shape as ConnectorShape;
      if (connector.sourceRef && connector.targetRef && copiedNodeIds.has(connector.sourceRef.shapeId)
        && copiedNodeIds.has(connector.targetRef.shapeId)) add(connector);
    }
    const originals = [...originalById.values()];
    if (!originals.length) return;
    const newIds = new Map(originals.map(shape => [shape.id, uid()]));
    const existingIds = new Set(this.shapes.keys());
    const newEventIds = new Map<string, string>();
    const newOccurrenceIds = new Map<string, string>();
    const newLifecycleIds = new Map<string, string>();
    const newStateRegionIds = new Map<string, string>();
    const newOperandIds = new Map<string, Map<string, string>>();
    const selectedSequenceFrameIds = new Set(selected.filter(shape => shape.type === 'diagram' && shape.shapeId === 'uml.frame')
      .map(shape => shape.id));
    const externalSequenceEndpointIds = new Set<string>();
    for (const shape of originals) {
      if (shape.type === 'diagram' && shape.shapeId === 'uml.composite-state') {
        const composite = shape.data?.stateComposite as { regions?: Array<{ id?: string }> } | undefined;
        const copiedCompositeId = newIds.get(shape.id)!;
        composite?.regions?.forEach((region, index) => {
          if (typeof region.id === 'string') newStateRegionIds.set(region.id, `region:${copiedCompositeId}:${index + 1}`);
        });
      }
      if (shape.type === 'connector' && getShapeDefinition(shape.shapeId)?.semantic?.family === 'uml.sequence-edge'
        && shape.sequenceEvent) {
        const eventId = `sequence-event:${uid()}`;
        newEventIds.set(shape.sequenceEvent.eventId, eventId);
        newOccurrenceIds.set(shape.sequenceEvent.sourceOccurrenceId, `${eventId}:source`);
        newOccurrenceIds.set(shape.sequenceEvent.targetOccurrenceId, `${eventId}:target`);
      }
      if (shape.type === 'diagram' && shape.shapeId === 'uml.destroy') {
        const lifecycle = shape.data?.sequenceLifecycle as { lifecycleId?: string } | undefined;
        if (lifecycle?.lifecycleId) newLifecycleIds.set(lifecycle.lifecycleId, newIds.get(shape.id)!);
      }
      if (shape.type === 'diagram' && shape.shapeId === 'uml.frame') {
        const fragment = shape.data?.sequenceFragment as SequenceFragmentData | undefined;
        const operandIds = new Map<string, string>();
        fragment?.operands.forEach((operand, index) => operandIds.set(operand.id, `operand:${newIds.get(shape.id)}:${index + 1}`));
        newOperandIds.set(shape.id, operandIds);
      }
    }
    const copies = originals.map(original => {
      let copy = cloneShapeWithOffset(original, newIds.get(original.id)!, 24, newIds, existingIds);
      if (copy.type === 'diagram') {
        const data = { ...(copy.data ?? {}) };
        const originalData = original.type === 'diagram' ? original.data ?? {} : {};
        if (copy.diagramContext === 'state') {
          const oldVertex = originalData.stateVertex as Record<string, unknown> | undefined;
          if (oldVertex) {
            const mappedRegion = typeof oldVertex.regionId === 'string' ? newStateRegionIds.get(oldVertex.regionId) : undefined;
            data.stateVertex = {
              version: 1,
              ...oldVertex,
              vertexId: copy.id,
              regionId: mappedRegion ?? (copy.containerId ? UML_STATE_FIRST_REGION_ID(copy.containerId) : UML_STATE_ROOT_REGION_ID),
            };
          }
          const oldBehavior = originalData.stateBehavior as Record<string, unknown> | undefined;
          if (oldBehavior) {
            data.stateBehavior = {
              version: 1,
              entry: '',
              doActivity: '',
              exit: '',
              ...oldBehavior,
              stateId: copy.id,
            };
          }
          const oldComposite = originalData.stateComposite as { regions?: Array<Record<string, unknown>> } | undefined;
          if (copy.shapeId === 'uml.composite-state' && oldComposite) {
            const regions = (oldComposite.regions ?? []).map((region, index) => ({
              name: typeof region.name === 'string' ? region.name : `Region ${index + 1}`,
              ...region,
              id: typeof region.id === 'string' ? newStateRegionIds.get(region.id) ?? `region:${copy.id}:${index + 1}` : '',
              order: index,
            }));
            data.stateComposite = {
              version: 1,
              ...oldComposite,
              stateId: copy.id,
              regions,
            };
          }
          const oldPoint = originalData.statePoint as Record<string, unknown> | undefined;
          if (oldPoint) {
            const ownerStateId = typeof oldPoint.ownerStateId === 'string' ? newIds.get(oldPoint.ownerStateId) : undefined;
            const statePoint = {
              version: 1 as const,
              ...oldPoint,
              pointId: copy.id,
              ...(ownerStateId ? { ownerStateId } : {}),
            };
            if (!ownerStateId) delete statePoint.ownerStateId;
            data.statePoint = statePoint;
          }
        }
        if (copy.diagramContext === 'activity') {
          const oldPartition = originalData.activityPartition as Record<string, unknown> | undefined;
          if (copy.shapeId === 'uml.activity-partition' && oldPartition) {
            data.activityPartition = {
              version: 1 as const,
              orientation: 'vertical',
              ...oldPartition,
              partitionId: copy.id,
            };
          }
          const oldNode = originalData.activityNode as Record<string, unknown> | undefined;
          if (oldNode) {
            const partitionId = typeof oldNode.partitionId === 'string' ? newIds.get(oldNode.partitionId) : undefined;
            const activityNode = {
              version: 1 as const,
              ...oldNode,
              nodeId: copy.id,
              ...(partitionId ? { partitionId } : {}),
            };
            if (!partitionId) delete activityNode.partitionId;
            data.activityNode = activityNode;
          }
        }
        if (copy.shapeId === 'uml.lifeline' || copy.shapeId === 'uml.sequence-actor'
          || copy.shapeId === 'uml.boundary' || copy.shapeId === 'uml.control' || copy.shapeId === 'uml.entity') {
          const old = original.type === 'diagram'
            ? (original.data?.sequenceParticipant as Record<string, unknown> | undefined) : undefined;
          const participant = { ...(old ?? {}), version: 1 as const, participantId: copy.id } as unknown as SequenceParticipantData;
          const creator = typeof old?.createdByMessageId === 'string' ? newIds.get(old.createdByMessageId) : undefined;
          const destroy = typeof old?.destroyedByEventId === 'string' ? newLifecycleIds.get(old.destroyedByEventId) : undefined;
          if (creator) participant.createdByMessageId = creator; else { delete participant.createdByMessageId; delete participant.createdAtOrder; }
          if (destroy) participant.destroyedByEventId = destroy; else { delete participant.destroyedByEventId; delete participant.destroyedAtOrder; }
          data.sequenceParticipant = participant;
        } else if (copy.shapeId === 'uml.activation') {
          const old = original.type === 'diagram'
            ? (original.data?.sequenceActivation as Record<string, unknown> | undefined) : undefined;
          const participantId = typeof old?.participantId === 'string' ? newIds.get(old.participantId) : undefined;
          const activation = { ...(old ?? {}), version: 1 as const, activationId: copy.id } as unknown as SequenceActivationData;
          if (participantId) activation.participantId = participantId; else delete activation.participantId;
          for (const key of ['startOccurrenceId', 'endOccurrenceId'] as const) {
            const value = typeof old?.[key] === 'string' ? newOccurrenceIds.get(old[key] as string) : undefined;
            if (value) activation[key] = value; else delete activation[key];
          }
          data.sequenceActivation = activation;
        } else if (copy.shapeId === 'uml.destroy') {
          const old = original.type === 'diagram'
            ? (original.data?.sequenceLifecycle as Record<string, unknown> | undefined) : undefined;
          const participantId = typeof old?.participantId === 'string' ? newIds.get(old.participantId) : undefined;
          const lifecycle = { ...(old ?? {}), version: 1 as const, lifecycleId: copy.id, kind: 'destroy' as const,
            visualY: typeof old?.visualY === 'number' ? old.visualY + 24 : copy.y + copy.h / 2,
            ...(participantId ? { participantId } : {}) } as unknown as SequenceLifecycleData;
          data.sequenceLifecycle = lifecycle;
          if (!participantId) delete (data.sequenceLifecycle as unknown as Record<string, unknown>).participantId;
        } else if (copy.shapeId === 'uml.frame') {
          const old = original.type === 'diagram'
            ? original.data?.sequenceFragment as SequenceFragmentData | undefined : undefined;
          if (old) {
            const operandIds = newOperandIds.get(original.id)!;
            data.sequenceFragment = { ...old, operands: old.operands.map(operand => ({
              ...operand, id: operandIds.get(operand.id) ?? `operand:${copy.id}:${operand.order + 1}`,
            })) };
          }
        }
        if (getShapeDefinition(copy.shapeId)?.semantic?.family?.startsWith('uml.sequence-') || copy.shapeId === 'uml.frame')
          copy = { ...copy, data: normalizeSequenceDiagramData(data, copy.shapeId, copy.id, copy.containerId,
            copy.h, copy.y + copy.h / 2) } as AnyShape;
      } else if (copy.type === 'connector') {
        if (copy.shapeId === 'uml.state-transition') {
          const transition = { ...(copy.stateTransition ?? {}) };
          const oldRegionId = original.type === 'connector' ? original.stateTransition?.regionId : undefined;
          const mappedRegion = typeof oldRegionId === 'string' ? newStateRegionIds.get(oldRegionId) : undefined;
          if (mappedRegion) transition.regionId = mappedRegion;
          else if (oldRegionId === UML_STATE_ROOT_REGION_ID || !copy.containerId) transition.regionId = UML_STATE_ROOT_REGION_ID;
          else delete transition.regionId;
          copy = { ...copy, stateTransition: transition };
        }
        if (original.type === 'connector' && original.containerId && selectedSequenceFrameIds.has(original.containerId)
          && getShapeDefinition(copy.shapeId)?.semantic?.family === 'uml.sequence-edge') {
          const copiedConnectorShapeId = copy.shapeId;
          const externalReference = (side: EndpointSide) => {
            const reference = side === 'source' ? original.sourceRef : original.targetRef;
            if (!reference || newIds.has(reference.shapeId)) return undefined;
            if (copiedConnectorShapeId === 'uml.create-message' && side === 'target' && reference.pointId === 'participant:create') return undefined;
            const owner = this.shapes.get(reference.shapeId);
            if (!owner || !this.sequenceParticipantIdForEndpoint(owner.id)) return undefined;
            externalSequenceEndpointIds.add(owner.id);
            return reference;
          };
          const sourceRef = externalReference('source'), targetRef = externalReference('target');
          if (sourceRef || targetRef) copy = { ...copy,
            ...(sourceRef ? { sourceRef, sourceIntent: 'attached' as const } : {}),
            ...(targetRef ? { targetRef, targetIntent: 'attached' as const } : {}),
          };
          if (copy.shapeId === 'uml.create-message' && original.targetRef?.pointId === 'participant:create'
            && !newIds.has(original.targetRef.shapeId)) copy = { ...copy, containerId: undefined };
        }
        const family = getShapeDefinition(copy.shapeId)?.semantic?.family;
        if (family === 'uml.relationship-edge' || family === 'uml.usecase-dependency'
          || family === 'uml.state-edge' || family === 'uml.activity-edge')
          copy = { ...copy, parallelOrder: this.nextParallelOrder++ };
        if (family === 'uml.sequence-edge' && original.type === 'connector' && original.sequenceEvent) {
          const old = original.sequenceEvent;
          const copiedSourceRef = (copy as ConnectorShape).sourceRef;
          const copiedTargetRef = (copy as ConnectorShape).targetRef;
          const participantForCopiedEndpoint = (side: EndpointSide, originalParticipantId?: string) => {
            const reference = side === 'source' ? copiedSourceRef : copiedTargetRef;
            if (!reference) return undefined;
            return (originalParticipantId ? newIds.get(originalParticipantId) : undefined)
              ?? this.sequenceParticipantIdForEndpoint(reference.shapeId);
          };
          const newSourceParticipant = participantForCopiedEndpoint('source', old.sourceParticipantId);
          const newTargetParticipant = participantForCopiedEndpoint('target', old.targetParticipantId);
          const eventId = newEventIds.get(old.eventId) ?? `sequence-event:${uid()}`;
          const sameParticipant = Boolean(newSourceParticipant && newSourceParticipant === newTargetParticipant);
          const sequenceEvent: SequenceMessageEventData = {
            ...old,
            eventId,
            messageId: copy.id,
            visualY: Math.round((old.visualY + 24) * 1000) / 1000,
            ...(old.targetVisualY !== undefined ? { targetVisualY: Math.round((old.targetVisualY + 24) * 1000) / 1000 } : {}),
            sourceOccurrenceId: newOccurrenceIds.get(old.sourceOccurrenceId) ?? `${eventId}:source`,
            targetOccurrenceId: newOccurrenceIds.get(old.targetOccurrenceId) ?? `${eventId}:target`,
            ...(copy.sourceRef ? { sourceEndpointId: copy.sourceRef.shapeId } : {}),
            ...(copy.targetRef ? { targetEndpointId: copy.targetRef.shapeId } : {}),
            ...(newSourceParticipant ? { sourceParticipantId: newSourceParticipant } : { sourceParticipantId: undefined }),
            ...(newTargetParticipant ? { targetParticipantId: newTargetParticipant } : { targetParticipantId: undefined }),
            ...(sameParticipant ? { selfCall: true } : { selfCall: undefined }),
          };
          if (!copy.sourceRef) delete sequenceEvent.sourceEndpointId;
          if (!copy.sourceRef || !newSourceParticipant) delete sequenceEvent.sourceParticipantId;
          if (!copy.targetRef) delete sequenceEvent.targetEndpointId;
          if (!copy.targetRef || !newTargetParticipant) delete sequenceEvent.targetParticipantId;
          if (!sameParticipant) {
            delete sequenceEvent.targetVisualY;
            if (sequenceEvent.kind === 'self-call') sequenceEvent.kind = 'synchronous';
          }
          if (old.returnForMessageId) {
            const returnLink = newIds.get(old.returnForMessageId);
            if (returnLink) sequenceEvent.returnForMessageId = returnLink;
            else delete sequenceEvent.returnForMessageId;
          }
          if (old.timelineId && newIds.has(old.timelineId)) sequenceEvent.timelineId = newIds.get(old.timelineId)!;
          if (old.fragmentId) {
            const fragmentId = newIds.get(old.fragmentId);
            const operandId = newOperandIds.get(old.fragmentId)?.get(old.operandId ?? '');
            if (fragmentId && operandId && copy.containerId === fragmentId) {
              sequenceEvent.fragmentId = fragmentId; sequenceEvent.operandId = operandId;
            } else {
              delete sequenceEvent.fragmentId; delete sequenceEvent.operandId;
            }
          }
          copy = { ...copy, sequenceTime: sequenceEvent.visualY, sequenceEvent };
        }
      }
      return copy;
    });
    this.putMany(copies, { syncAttachments: false });
    const copiedSequenceConnectors = copies.filter((copy): copy is ConnectorShape => copy.type === 'connector'
      && getShapeDefinition(copy.shapeId)?.semantic?.family === 'uml.sequence-edge' && Boolean(copy.sequenceEvent));
    const copiesByTimeline = new Map<string, ConnectorShape[]>();
    for (const copy of copiedSequenceConnectors) {
      const timelineKey = copy.sequenceEvent?.timelineId ?? '';
      const group = copiesByTimeline.get(timelineKey) ?? [];
      group.push(copy); copiesByTimeline.set(timelineKey, group);
    }
    for (const [timelineKey, timelineCopies] of copiesByTimeline) {
      timelineCopies.sort((left, right) => left.sequenceEvent!.visualY - right.sequenceEvent!.visualY
        || compareSequenceEvents(left.sequenceEvent!, right.sequenceEvent!));
      const pendingIds = new Set(timelineCopies.map(copy => copy.id));
      const parallelCopyGroups: ConnectorShape[][] = [];
      for (const copy of timelineCopies) {
        const previous = parallelCopyGroups.at(-1);
        const previousY = previous?.[0]?.sequenceEvent?.visualY;
        if (previous && previousY !== undefined && Math.abs(copy.sequenceEvent!.visualY - previousY) <= 1.25)
          previous.push(copy);
        else parallelCopyGroups.push([copy]);
      }
      for (const parallelCopies of parallelCopyGroups) {
        const visualY = parallelCopies[0].sequenceEvent!.visualY;
        // putMany inserts the complete cloned subgraph at once. Ignore the not-yet-positioned
        // copies while finding this group's logical slot, otherwise a peer's copied old order
        // would make a new time appear to be parallel with its source event. Earlier clone groups
        // have already received their new token and remain available as preceding events.
        const order = this.sequenceOrderAtVisualY(visualY, timelineKey || undefined, pendingIds);
        for (const copy of parallelCopies) {
          const live = this.shapes.get(copy.id);
          if (live?.type === 'connector' && live.sequenceEvent && live.sequenceEvent.order !== order) {
            const sequenceEvent = { ...live.sequenceEvent, order };
            this.put({ ...live, sequenceEvent, sequenceTime: live.sequenceEvent.visualY }, { notify: false, syncAttachments: false });
          }
          pendingIds.delete(copy.id);
        }
      }
    }
    externalSequenceEndpointIds.forEach(endpointId => this.updateAttachedConnectors(endpointId));
    for (const copy of copies) {
      if (copy.type === 'connector' && copy.shapeId === 'uml.create-message')
        this.synchronizeSequenceCreateOwnership(copy as ConnectorShape);
      if (copy.type === 'diagram' && getShapeDefinition(copy.shapeId)?.semantic?.connectionPointProvider === 'sequence-lifeline')
        this.synchronizeSequenceDestruction(copy as DiagramShape);
    }
    this.rebalanceParallelConnectorLanes();
    this.sel.clear();
    for (const id of newIds.values()) this.sel.add(id);
    this.onSel?.([...this.sel]);
    this.saveH();
  }

  private wrapCanvasText(text: string, maxWidth: number): string[] {
    const context = this.cx, safeWidth = Math.max(1, maxWidth), lines: string[] = [];
    for (const sourceLine of String(text ?? '').split(/\r?\n/)) {
      if (!sourceLine.trim()) { lines.push(''); continue; }
      let line = '';
      for (const word of sourceLine.trim().split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && context.measureText(candidate).width <= safeWidth) { line = candidate; continue; }
        if (!line && context.measureText(word).width <= safeWidth) { line = word; continue; }
        if (line) { lines.push(line); line = ''; }
        let fragment = '';
        for (const character of [...word]) {
          if (fragment && context.measureText(fragment + character).width > safeWidth) {
            lines.push(fragment); fragment = character;
          } else fragment += character;
        }
        line = fragment;
      }
      if (line) lines.push(line);
    }
    return lines.length ? lines : [''];
  }

  private diagramContentMinimumSize(shape: DiagramShape, text = shape.text ?? '', data = shape.data): { width: number; height: number } | null {
    const definition = getShapeDefinition(shape.shapeId);
    if (!definition) return null;
    if (['uml.lifeline', 'uml.sequence-actor', 'uml.boundary', 'uml.control', 'uml.entity'].includes(shape.shapeId)) {
      const headerH = Math.min(definition.height, sequenceParticipantHeaderHeight(definition.geometry));
      return { width: Math.max(48, Math.round(definition.width * 0.5)), height: headerH + 30 };
    }
    if (shape.shapeId === 'uml.activation') {
      return { width: 16, height: 40 };
    }
    if (shape.shapeId === 'uml.destroy') {
      return { width: 24, height: 24 };
    }
    if (['uml.frame', 'uml.package', 'uml.component'].includes(shape.shapeId)) {
      return { width: 140, height: 90 };
    }
    const textCapabilities = diagramCapabilitiesFor(definition, shape.diagramContext).text;
    const baseFontSize = Math.max(textCapabilities.minFontSize ?? 12, shape.fs ?? 14);
    const typography = diagramTypography(textCapabilities.role ?? 'state', baseFontSize, textCapabilities.minFontSize ?? 12);
    const context = this.cx;
    if (shape.shapeId === 'uml.state' || shape.shapeId === 'uml.composite-state') {
      const behavior = (isRecord(data?.stateBehavior) ? data.stateBehavior : {}) as Record<string, unknown>;
      const behaviorRows = [
        typeof behavior.entry === 'string' && behavior.entry.trim() ? `entry / ${behavior.entry.trim()}` : '',
        typeof behavior.doActivity === 'string' && behavior.doActivity.trim() ? `do / ${behavior.doActivity.trim()}` : '',
        typeof behavior.exit === 'string' && behavior.exit.trim() ? `exit / ${behavior.exit.trim()}` : '',
      ].filter(Boolean);
      if (behaviorRows.length) {
        context.save();
        context.font = `${typography.secondary}px Inter, 'Segoe UI', sans-serif`;
        const maxLine = Math.max(0, ...behaviorRows.map(row => context.measureText(row).width));
        const width = Math.max(definition.width, maxLine + 30);
        const lines = behaviorRows.reduce((count, row) => count + this.wrapCanvasText(row, Math.max(24, width - 24)).length, 0);
        const titleHeight = Math.max(typography.title * 1.55, 24);
        const behaviorHeight = Math.max(1, lines) * typography.secondary * 1.2;
        const sectionHeight = titleHeight + behaviorHeight + 14;
        const height = shape.shapeId === 'uml.composite-state'
          ? Math.max(definition.height, sectionHeight / 0.46)
          : Math.max(definition.height, sectionHeight + 16);
        context.restore();
        return { width, height };
      }
    }
    if (definition.dataCapabilities?.includes('classifier') && isRecord(data?.classifier)
      && Array.isArray(data.classifier.compartments)) {
      const classifier = data.classifier as unknown as UMLClassifierData;
      const name = text.trim() || definition.label;
      const stereotype = typeof shape.params?.stereotype === 'string' ? shape.params.stereotype : '';
      const measure = (value: string) => {
        context.save(); context.font = `${typography.title}px Inter, 'Segoe UI', sans-serif`;
        const titleWidth = context.measureText(value).width;
        context.font = `${typography.body}px Inter, 'Segoe UI', sans-serif`;
        const bodyWidth = context.measureText(value).width; context.restore();
        return Math.max(titleWidth, bodyWidth);
      };
      context.save();
      const layout = classifierLayout(classifier, name, stereotype, typography.title, typography.body, measure);
      context.restore();
      return { width: layout.minWidth, height: layout.minHeight };
    }
    if (definition.dataCapabilities?.includes('instance') && isRecord(data?.instance)
      && Array.isArray(data.instance.values)) {
      const instance = data.instance as unknown as UMLInstanceData;
      const name = text.trim() || definition.label;
      context.save();
      const layout = instanceLayout(instance, name, typography.title, typography.body, value => {
        context.font = `${typography.title}px Inter, 'Segoe UI', sans-serif`;
        const titleWidth = context.measureText(value).width;
        context.font = `${typography.body}px Inter, 'Segoe UI', sans-serif`;
        return Math.max(titleWidth, context.measureText(value).width);
      });
      context.restore();
      return { width: layout.minWidth, height: layout.minHeight };
    }
    if (textCapabilities.role !== 'use-case' && textCapabilities.role !== 'actor') return null;
    context.save(); context.font = `${typography.body}px Inter, 'Segoe UI', sans-serif`;
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    const longestWord = Math.max(0, ...words.map(word => context.measureText(word).width));
    const aspect = Number.isFinite(diagramCapabilitiesFor(definition, shape.diagramContext).transform.aspectRatio)
      ? diagramCapabilitiesFor(definition, shape.diagramContext).transform.aspectRatio! : definition.width / Math.max(1, definition.height);
    let width = Math.max(definition.width,
      textCapabilities.role === 'use-case' ? (longestWord + 24) / 0.68 : (longestWord + 12) / 0.90);
    let height = Math.max(definition.height, width / aspect);
    const textWidthRatio = textCapabilities.role === 'use-case' ? 0.68 : 0.90;
    const labelHeightRatio = textCapabilities.role === 'use-case' ? 0.60 : 0.19;
    for (let pass = 0; pass < 4; pass++) {
      const lines = this.wrapCanvasText(text, width * textWidthRatio);
      const requiredHeight = Math.max(definition.height, lines.length * typography.body * 1.25 / labelHeightRatio + 12);
      const nextHeight = Math.max(definition.height, requiredHeight);
      const nextWidth = Math.max(width, nextHeight * aspect);
      if (nextHeight === height && nextWidth === width) break;
      height = nextHeight; width = nextWidth;
    }
    const extensionPoints = (data?.usecase as UMLUseCaseData | undefined)?.extensionPoints ?? [];
    if (textCapabilities.role === 'use-case' && extensionPoints.length > 0) {
      context.font = `${typography.secondary}px Inter, 'Segoe UI', sans-serif`;
      const longestEp = Math.max(
        context.measureText('extension points').width,
        ...extensionPoints.map(ep => context.measureText(ep.explanation ? `${ep.name} : ${ep.explanation}` : ep.name).width),
      );
      width = Math.max(width, (longestEp + 28) / 0.72);
      const epHeight = (extensionPoints.length + 1) * typography.secondary * 1.25 + 16;
      height = Math.max(height, height * 0.55 + epHeight + 14);
    }
    context.restore();
    return { width, height };
  }

  private growDiagramTextBox(shape: DiagramShape, text: string, data = shape.data): DiagramShape {
    const definition = getShapeDefinition(shape.shapeId);
    const capabilities = diagramCapabilitiesFor(definition, shape.diagramContext);
    const textCapability = capabilities.text;
    if (textCapability.editable === false) return { ...shape, text };
    // Persist the canonical base size; role-specific display levels never compound into shape.fs.
    const baseFontSize = Math.max(textCapability.minFontSize ?? 12, shape.fs ?? 14);
    const contentMinimum = this.diagramContentMinimumSize(shape, text, data);
    if (contentMinimum) {
      let w = Math.max(shape.w, contentMinimum.width), h = Math.max(shape.h, contentMinimum.height);
      if (capabilities.transform.aspectLocked) {
        const aspect = Number.isFinite(capabilities.transform.aspectRatio) && (capabilities.transform.aspectRatio ?? 0) > 0
          ? capabilities.transform.aspectRatio! : Math.max(0.1, shape.w / Math.max(1, shape.h));
        w = Math.max(w, h * aspect); h = w / aspect;
      }
      return withComputedShapeBounds({ ...shape, text, fs: baseFontSize, w, h } as DiagramShape) as DiagramShape;
    }
    const roleTypography = diagramTypography(textCapability.role ?? 'state', baseFontSize, textCapability.minFontSize ?? 12);
    const fs = roleTypography.body, measureFs = Math.max(roleTypography.body, roleTypography.title);
    const context = this.cx;
    context.save(); context.font = `${measureFs}px Inter, 'Segoe UI', sans-serif`;
    const measure = (value: string) => context.measureText(value).width;
    const sourceLines = String(text ?? '').split(/\r?\n/);
    const contentLines = sourceLines;
    const longestWord = Math.max(0, ...contentLines.flatMap(line => line.split(/\s+/).filter(Boolean).map(measure)));
    const longestWholeLine = Math.max(0, ...contentLines.map(measure));
    const horizontalPadding = Math.max(24, measureFs * 1.6);
    const noWrapRole = textCapability.role === 'container-title' || textCapability.role === 'sequence-participant'
      || textCapability.role === 'classifier' || textCapability.role === 'partition-title';
    const targetWidth = Math.max(shape.w, (noWrapRole ? longestWholeLine : longestWord) + horizontalPadding);
    const lineWidthLimit = Math.max(fs * 2, Math.max(shape.w, targetWidth) - horizontalPadding);
    let lineCount = this.wrapCanvasText(text, lineWidthLimit).length;
    context.restore();
    let w = textCapability.autoGrow === false ? shape.w : targetWidth;
    let h = Math.max(shape.h, (lineCount || 1) * fs * 1.35 + Math.max(18, fs * 1.4));
    if (capabilities.transform.aspectLocked) {
      const aspect = Number.isFinite(capabilities.transform.aspectRatio) && (capabilities.transform.aspectRatio ?? 0) > 0
        ? capabilities.transform.aspectRatio! : Math.max(0.1, shape.w / Math.max(1, shape.h));
      w = Math.max(w, h * aspect); h = w / aspect;
    }
    return withComputedShapeBounds({ ...shape, text, fs: baseFontSize, w, h } as DiagramShape) as DiagramShape;
  }

  /** Keep an explicitly-owned Use Case inside its System Boundary after content growth or resize. */
  private ensureUseCaseChildFitsBoundary(child: DiagramShape, origin: object = this) {
    const childDefinition = getShapeDefinition(child.shapeId);
    if (childDefinition?.semantic?.family !== 'uml.use-case' || !child.containerId) return;
    const parent = this.shapes.get(child.containerId);
    if (!parent || parent.type !== 'diagram') return;
    const boundary = parent as DiagramShape, boundaryDefinition = getShapeDefinition(boundary.shapeId);
    if (boundaryDefinition?.semantic?.family !== 'uml.use-case.container'
      || !containerAcceptsSemanticChild(boundaryDefinition, childDefinition)) return;
    const localCorners = rotatedBoxCorners(child).map(([x, y]) => worldPointToObject(boundary, { x, y }));
    const minX = Math.min(...localCorners.map(point => point.x)), maxX = Math.max(...localCorners.map(point => point.x));
    const minY = Math.min(...localCorners.map(point => point.y)), maxY = Math.max(...localCorners.map(point => point.y));
    const padding = 16, contentTop = UML_BOUNDARY_TITLE_HEIGHT;
    const left = Math.ceil(Math.max(0, padding - minX));
    const top = Math.ceil(Math.max(0, contentTop + padding - minY));
    const right = Math.ceil(Math.max(0, maxX + padding - boundary.w));
    const bottom = Math.ceil(Math.max(0, maxY + padding - boundary.h));
    if (!left && !top && !right && !bottom) return;
    const w = boundary.w + left + right, h = boundary.h + top + bottom;
    // Expand in boundary-local coordinates while preserving its center-relative transform; this
    // moves only the frame, not the explicitly owned Use Case or its canonical typography.
    const radians = (boundary.rotation ?? 0) * Math.PI / 180;
    const localCenterShiftX = (right - left) / 2, localCenterShiftY = (bottom - top) / 2;
    const centerShiftX = localCenterShiftX * Math.cos(radians) - localCenterShiftY * Math.sin(radians);
    const centerShiftY = localCenterShiftX * Math.sin(radians) + localCenterShiftY * Math.cos(radians);
    const x = boundary.x + boundary.w / 2 + centerShiftX - w / 2;
    const y = boundary.y + boundary.h / 2 + centerShiftY - h / 2;
    this.put({ ...boundary, x, y, w, h }, { origin });
  }

  private canEditShapeText(shape: AnyShape): boolean {
    if (shape.type === 'diagram') return diagramCapabilitiesFor(getShapeDefinition(shape.shapeId)).text.editable === true;
    if (shape.type === 'connector') return diagramCapabilitiesFor(getShapeDefinition(shape.shapeId)).connector?.labelMode === 'plain';
    return 'text' in shape || isLabelEditableShape(shape);
  }

  updateText(id: string, text: string) {
    const shape = this.shapes.get(id);
    if (!shape || !this.canEditShapeText(shape)) return;
    const next = shape.type === 'diagram' ? this.growDiagramTextBox(shape as DiagramShape, text)
      : { ...shape, text } as AnyShape;
    this.put(next as AnyShape);
    this.saveH();
  }

  updateTextLive(id: string, text: string) {
    const shape = this.shapes.get(id);
    if (!shape || !this.canEditShapeText(shape)) return;
    const next = shape.type === 'diagram' ? this.growDiagramTextBox(shape as DiagramShape, text)
      : { ...shape, text } as AnyShape;
    this.put(next as AnyShape);
  }

  public getClassifierHit(shapeId: string, clientX: number, clientY: number): (ClassifierHitResult & { localBounds: { x: number; y: number; w: number; h: number }; clientBounds: { l: number; t: number; w: number; h: number } }) | null {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return null;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def) return null;
    const kind = classifierKindForShape(def.id);
    if (!kind) return null;

    const fontScale = Number.isFinite(diagram.embeddedTextScale) && (diagram.embeddedTextScale ?? 0) > 0
      ? Math.max(0.25, Math.min(16, diagram.embeddedTextScale!))
      : Math.sqrt((diagram.w / Math.max(1, def.width)) * (diagram.h / Math.max(1, def.height)));
    const baseFs = (diagram.fs ?? 14) * Math.min(4, Math.max(0.4, fontScale));
    const textCapabilities = diagramCapabilitiesFor(def, this.getSemanticContextForShape(diagram.id)).text;
    const typography = diagramTypography(textCapabilities.role ?? 'classifier', baseFs, textCapabilities.minFontSize ?? 12);
    const name = typeof diagram.text === 'string' && diagram.text.trim() ? diagram.text.trim() : def.label;
    const stereotype = typeof diagram.params?.stereotype === 'string' ? diagram.params.stereotype : '';

    const measure = (val: string) => {
      this.cx.save();
      this.cx.font = `${typography.body}px Inter, 'Segoe UI', sans-serif`;
      const measuredW = this.cx.measureText(val).width;
      this.cx.restore();
      return measuredW;
    };

    const world = this.clientToWorld(clientX, clientY);
    const rad = (diagram.rotation ?? 0) * (Math.PI / 180);
    const centerPointX = diagram.x + diagram.w / 2, centerPointY = diagram.y + diagram.h / 2;
    const deltaX = world.x - centerPointX, deltaY = world.y - centerPointY;
    const localX = (deltaX * Math.cos(-rad) - deltaY * Math.sin(-rad)) + diagram.w / 2;
    const localY = (deltaX * Math.sin(-rad) + deltaY * Math.cos(-rad)) + diagram.h / 2;

    let hit: ClassifierHitResult;
    let localRow: { x: number; y: number; w: number; h: number };

    if (kind === 'object') {
      const rawInstance = (diagram.data?.instance ?? def.defaultData?.instance) as import('./shapes/types').UMLInstanceData;
      if (!rawInstance) return null;
      const layout = instanceLayout(rawInstance, name, typography.title, typography.body, measure);
      hit = hitTestInstance(layout, localX, localY, diagram.w, diagram.h, name, typography.title, typography.body);
      localRow = hit.rowBounds;
    } else {
      const rawClassifier = (diagram.data?.classifier ?? def.defaultData?.classifier) as unknown as import('./shapes/types').UMLClassifierData;
      if (!rawClassifier) return null;
      const layout = classifierLayout(rawClassifier, name, stereotype, typography.title, typography.body, measure);
      hit = hitTestClassifier(layout, localX, localY, diagram.w, diagram.h, name, typography.title, typography.body);
      localRow = hit.rowBounds;
    }

    const rowWorldCenter = {
      x: diagram.x + localRow.x + localRow.w / 2,
      y: diagram.y + localRow.y + localRow.h / 2,
    };
    const rowWorldRotated = rad !== 0 ? {
      x: centerPointX + (rowWorldCenter.x - centerPointX) * Math.cos(rad) - (rowWorldCenter.y - centerPointY) * Math.sin(rad),
      y: centerPointY + (rowWorldCenter.x - centerPointX) * Math.sin(rad) + (rowWorldCenter.y - centerPointY) * Math.cos(rad),
    } : rowWorldCenter;

    const sp = this.worldToClient(rowWorldRotated.x - localRow.w / 2, rowWorldRotated.y - localRow.h / 2);
    const clientBounds = {
      l: sp.x,
      t: sp.y,
      w: localRow.w * this.cam.zoom,
      h: localRow.h * this.cam.zoom,
    };

    return {
      ...hit,
      localBounds: localRow,
      clientBounds,
    };
  }

  public updateClassifierMember(shapeId: string, memberId: string, text: string): boolean {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return false;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def) return false;

    if (def.id === 'uml.object') {
      const rawInstance = (diagram.data?.instance ?? def.defaultData?.instance) as import('./shapes/types').UMLInstanceData;
      if (!rawInstance) return false;
      const updatedValue = parseInstanceValueText(text, memberId);
      const nextInstance = updateInstanceValueInModel(rawInstance, memberId, updatedValue);
      this.put({
        ...diagram,
        data: {
          ...(diagram.data ?? {}),
          instance: nextInstance,
        },
      });
      this.dirty = true;
      this.saveH();
      return true;
    }

    const rawClassifier = (diagram.data?.classifier ?? def.defaultData?.classifier) as unknown as import('./shapes/types').UMLClassifierData;
    if (!rawClassifier) return false;

    let kind: UMLClassifierCompartmentKind = 'attributes';
    for (const comp of rawClassifier.compartments) {
      if (comp.items.some(it => it.id === memberId)) {
        kind = comp.kind;
        break;
      }
    }

    const updatedMember = parseClassifierMemberText(text, kind, memberId);
    const nextClassifier = updateClassifierMemberInModel(rawClassifier, memberId, updatedMember as any);
    this.put({
      ...diagram,
      data: {
        ...(diagram.data ?? {}),
        classifier: nextClassifier,
      },
    });
    this.dirty = true;
    this.saveH();
    return true;
  }

  public addClassifierMember(
    shapeId: string,
    compartmentKind: UMLClassifierCompartmentKind,
    text: string,
    afterMemberId?: string,
  ): string | null {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return null;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def) return null;

    if (def.id === 'uml.object') {
      const rawInstance = (diagram.data?.instance ?? def.defaultData?.instance) as import('./shapes/types').UMLInstanceData;
      if (!rawInstance) return null;
      const newMember = parseInstanceValueText(text);
      const nextInstance = addInstanceValueToModel(rawInstance, newMember, afterMemberId);
      this.put({
        ...diagram,
        data: {
          ...(diagram.data ?? {}),
          instance: nextInstance,
        },
      });
      this.dirty = true;
      this.saveH();
      return newMember.id;
    }

    const rawClassifier = (diagram.data?.classifier ?? def.defaultData?.classifier) as unknown as import('./shapes/types').UMLClassifierData;
    if (!rawClassifier) return null;

    const newMember = parseClassifierMemberText(text, compartmentKind);
    const nextClassifier = addClassifierMemberToModel(rawClassifier, compartmentKind, newMember as any, afterMemberId);

    const fontScale = Number.isFinite(diagram.embeddedTextScale) && (diagram.embeddedTextScale ?? 0) > 0
      ? Math.max(0.25, Math.min(16, diagram.embeddedTextScale!))
      : Math.sqrt((diagram.w / Math.max(1, def.width)) * (diagram.h / Math.max(1, def.height)));
    const baseFs = (diagram.fs ?? 14) * Math.min(4, Math.max(0.4, fontScale));
    const textCapabilities = diagramCapabilitiesFor(def, this.getSemanticContextForShape(diagram.id)).text;
    const typography = diagramTypography(textCapabilities.role ?? 'classifier', baseFs, textCapabilities.minFontSize ?? 12);
    const name = typeof diagram.text === 'string' && diagram.text.trim() ? diagram.text.trim() : def.label;
    const stereotype = typeof diagram.params?.stereotype === 'string' ? diagram.params.stereotype : '';
    const layout = classifierLayout(nextClassifier, name, stereotype, typography.title, typography.body, s => s.length * 8);
    const nextH = Math.max(diagram.h, layout.minHeight);

    this.put({
      ...diagram,
      h: nextH,
      data: {
        ...(diagram.data ?? {}),
        classifier: nextClassifier,
      },
    });
    this.dirty = true;
    this.saveH();
    return newMember.id;
  }

  public removeClassifierMember(shapeId: string, memberId: string): boolean {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return false;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def) return false;

    if (def.id === 'uml.object') {
      const rawInstance = (diagram.data?.instance ?? def.defaultData?.instance) as import('./shapes/types').UMLInstanceData;
      if (!rawInstance) return false;
      const nextInstance = removeInstanceValueFromModel(rawInstance, memberId);
      this.put({
        ...diagram,
        data: {
          ...(diagram.data ?? {}),
          instance: nextInstance,
        },
      });
      this.dirty = true;
      this.saveH();
      return true;
    }

    const rawClassifier = (diagram.data?.classifier ?? def.defaultData?.classifier) as unknown as import('./shapes/types').UMLClassifierData;
    if (!rawClassifier) return false;

    const nextClassifier = removeClassifierMemberFromModel(rawClassifier, memberId);
    this.put({
      ...diagram,
      data: {
        ...(diagram.data ?? {}),
        classifier: nextClassifier,
      },
    });
    this.dirty = true;
    this.saveH();
    return true;
  }

  public getClassifierMemberBounds(shapeId: string, memberId: string): { localBounds: { x: number; y: number; w: number; h: number }; clientBounds: { l: number; t: number; w: number; h: number }; fontSize: number; textAlign: 'left' | 'center'; initialText: string; compartmentKind: UMLClassifierCompartmentKind } | null {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return null;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def) return null;

    const fontScale = Number.isFinite(diagram.embeddedTextScale) && (diagram.embeddedTextScale ?? 0) > 0
      ? Math.max(0.25, Math.min(16, diagram.embeddedTextScale!))
      : Math.sqrt((diagram.w / Math.max(1, def.width)) * (diagram.h / Math.max(1, def.height)));
    const baseFs = (diagram.fs ?? 14) * Math.min(4, Math.max(0.4, fontScale));
    const textCapabilities = diagramCapabilitiesFor(def, this.getSemanticContextForShape(diagram.id)).text;
    const typography = diagramTypography(textCapabilities.role ?? 'classifier', baseFs, textCapabilities.minFontSize ?? 12);
    const name = typeof diagram.text === 'string' && diagram.text.trim() ? diagram.text.trim() : def.label;
    const stereotype = typeof diagram.params?.stereotype === 'string' ? diagram.params.stereotype : '';

    const measure = (val: string) => {
      this.cx.save();
      this.cx.font = `${typography.body}px Inter, 'Segoe UI', sans-serif`;
      const measuredW = this.cx.measureText(val).width;
      this.cx.restore();
      return measuredW;
    };

    if (def.id === 'uml.object') {
      const rawInstance = (diagram.data?.instance ?? def.defaultData?.instance) as import('./shapes/types').UMLInstanceData;
      if (!rawInstance) return null;
      const layout = instanceLayout(rawInstance, name, typography.title, typography.body, measure);
      const row = layout.rows.find(r => r.member.id === memberId);
      if (!row) return null;
      const localRow = {
        x: layout.paddingX,
        y: row.y - layout.rowHeight / 2,
        w: Math.max(40, diagram.w - layout.paddingX * 2),
        h: layout.rowHeight,
      };
      const rad = (diagram.rotation ?? 0) * (Math.PI / 180);
      const centerPointX = diagram.x + diagram.w / 2, centerPointY = diagram.y + diagram.h / 2;
      const rowWorldCenter = {
        x: diagram.x + localRow.x + localRow.w / 2,
        y: diagram.y + localRow.y + localRow.h / 2,
      };
      const rowWorldRotated = rad !== 0 ? {
        x: centerPointX + (rowWorldCenter.x - centerPointX) * Math.cos(rad) - (rowWorldCenter.y - centerPointY) * Math.sin(rad),
        y: centerPointY + (rowWorldCenter.x - centerPointX) * Math.sin(rad) + (rowWorldCenter.y - centerPointY) * Math.cos(rad),
      } : rowWorldCenter;
      const sp = this.worldToClient(rowWorldRotated.x - localRow.w / 2, rowWorldRotated.y - localRow.h / 2);
      return {
        localBounds: localRow,
        clientBounds: {
          l: sp.x,
          t: sp.y,
          w: localRow.w * this.cam.zoom,
          h: localRow.h * this.cam.zoom,
        },
        fontSize: typography.body,
        textAlign: 'left',
        initialText: row.text,
        compartmentKind: 'values',
      };
    }

    const rawClassifier = (diagram.data?.classifier ?? def.defaultData?.classifier) as unknown as import('./shapes/types').UMLClassifierData;
    if (!rawClassifier) return null;

    const layout = classifierLayout(rawClassifier, name, stereotype, typography.title, typography.body, measure);
    const row = layout.rows.find(r => r.member.id === memberId);
    if (!row) return null;

    const localRow = {
      x: layout.paddingX,
      y: row.y - layout.rowHeight / 2,
      w: Math.max(40, diagram.w - layout.paddingX * 2),
      h: layout.rowHeight,
    };
    const rad = (diagram.rotation ?? 0) * (Math.PI / 180);
    const centerPointX = diagram.x + diagram.w / 2, centerPointY = diagram.y + diagram.h / 2;
    const rowWorldCenter = {
      x: diagram.x + localRow.x + localRow.w / 2,
      y: diagram.y + localRow.y + localRow.h / 2,
    };
    const rowWorldRotated = rad !== 0 ? {
      x: centerPointX + (rowWorldCenter.x - centerPointX) * Math.cos(rad) - (rowWorldCenter.y - centerPointY) * Math.sin(rad),
      y: centerPointY + (rowWorldCenter.x - centerPointX) * Math.sin(rad) + (rowWorldCenter.y - centerPointY) * Math.cos(rad),
    } : rowWorldCenter;

    const sp = this.worldToClient(rowWorldRotated.x - localRow.w / 2, rowWorldRotated.y - localRow.h / 2);
    return {
      localBounds: localRow,
      clientBounds: {
        l: sp.x,
        t: sp.y,
        w: localRow.w * this.cam.zoom,
        h: localRow.h * this.cam.zoom,
      },
      fontSize: typography.body,
      textAlign: 'left',
      initialText: row.text,
      compartmentKind: row.compartmentKind,
    };
  }

  public getErTableHit(shapeId: string, clientX: number, clientY: number): {
    target: 'header' | 'column';
    columnIndex?: number;
    initialText: string;
    localBounds: { x: number; y: number; w: number; h: number };
    clientBounds: { l: number; t: number; w: number; h: number };
    fontSize: number;
    textAlign: 'left' | 'center';
  } | null {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return null;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def || (def.id !== 'erd.er-table' && def.id !== 'erd.table' && def.id !== 'erd.view')) return null;

    const rawColumns = (diagram.data?.table as { columns?: unknown[] } | undefined)?.columns ?? (def.defaultData?.table as { columns?: unknown[] } | undefined)?.columns ?? [];
    const columns = rawColumns.filter(isRecord);
    const layout = structuredTableLayout(diagram.h, columns.length + 1);

    const world = this.clientToWorld(clientX, clientY);
    const rad = (diagram.rotation ?? 0) * (Math.PI / 180);
    const centerPointX = diagram.x + diagram.w / 2, centerPointY = diagram.y + diagram.h / 2;
    const deltaX = world.x - centerPointX, deltaY = world.y - centerPointY;
    const _localX = (deltaX * Math.cos(-rad) - deltaY * Math.sin(-rad)) + diagram.w / 2;
    const localY = (deltaX * Math.sin(-rad) + deltaY * Math.cos(-rad)) + diagram.h / 2;
    void _localX;

    const fontScale = Number.isFinite(diagram.embeddedTextScale) ? Math.max(0.01, Math.min(64, diagram.embeddedTextScale!)) : 1;
    const fs = Math.max(1.25, Math.min(96, (diagram.fs ?? 14) * fontScale));
    const padX = Math.max(8, diagram.w * 0.05);
    const contentW = Math.max(40, diagram.w - padX * 2);
    const title = typeof diagram.text === 'string' && diagram.text.trim() ? diagram.text.trim() : def.label;

    let target: 'header' | 'column' = 'header';
    let columnIndex: number | undefined;
    let initialText = title;
    let localRow = { x: padX, y: 0, w: contentW, h: layout.rowHeight };

    if (localY <= layout.rowHeight) {
      target = 'header';
      initialText = title;
      localRow = { x: padX, y: 0, w: contentW, h: layout.rowHeight };
    } else {
      const idx = Math.min(columns.length - 1, Math.max(0, Math.floor((localY - layout.rowHeight) / layout.rowHeight)));
      target = 'column';
      columnIndex = idx;
      const col = columns[idx] as { name?: string; type?: string; key?: string; nullable?: boolean; notNull?: boolean };
      const key = col.key === 'primary' ? 'PK ' : col.key === 'foreign' ? 'FK ' : col.key === 'primary_foreign' ? 'PK,FK ' : col.key === 'unique' ? 'UK ' : '';
      const notNullSuffix = col.nullable === false || col.notNull === true ? ' NOT NULL' : '';
      const name = col.name ?? `column_${idx + 1}`;
      const type = col.type ? ` : ${col.type}` : '';
      initialText = `${key}${name}${type}${notNullSuffix}`;
      localRow = { x: padX, y: (idx + 1) * layout.rowHeight, w: contentW, h: layout.rowHeight };
    }

    const rowWorldCenter = {
      x: diagram.x + localRow.x + localRow.w / 2,
      y: diagram.y + localRow.y + localRow.h / 2,
    };
    const rowWorldRotated = rad !== 0 ? {
      x: centerPointX + (rowWorldCenter.x - centerPointX) * Math.cos(rad) - (rowWorldCenter.y - centerPointY) * Math.sin(rad),
      y: centerPointY + (rowWorldCenter.x - centerPointX) * Math.sin(rad) + (rowWorldCenter.y - centerPointY) * Math.cos(rad),
    } : rowWorldCenter;
    const sp = this.worldToClient(rowWorldRotated.x - localRow.w / 2, rowWorldRotated.y - localRow.h / 2);

    return {
      target,
      columnIndex,
      initialText,
      localBounds: localRow,
      clientBounds: {
        l: sp.x,
        t: sp.y,
        w: localRow.w * this.cam.zoom,
        h: localRow.h * this.cam.zoom,
      },
      fontSize: fs,
      textAlign: 'left',
    };
  }

  public getErTableColumnBounds(shapeId: string, columnIndex: number): {
    localBounds: { x: number; y: number; w: number; h: number };
    clientBounds: { l: number; t: number; w: number; h: number };
    fontSize: number;
    textAlign: 'left';
    initialText: string;
  } | null {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return null;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def || (def.id !== 'erd.er-table' && def.id !== 'erd.table' && def.id !== 'erd.view')) return null;

    const rawColumns = (diagram.data?.table as { columns?: unknown[] } | undefined)?.columns ?? (def.defaultData?.table as { columns?: unknown[] } | undefined)?.columns ?? [];
    const columns = rawColumns.filter(isRecord);
    if (columnIndex < 0 || columnIndex >= columns.length) return null;

    const layout = structuredTableLayout(diagram.h, columns.length + 1);
    const fontScale = Number.isFinite(diagram.embeddedTextScale) ? Math.max(0.01, Math.min(64, diagram.embeddedTextScale!)) : 1;
    const fs = Math.max(1.25, Math.min(96, (diagram.fs ?? 14) * fontScale));
    const padX = Math.max(8, diagram.w * 0.05);
    const contentW = Math.max(40, diagram.w - padX * 2);

    const col = columns[columnIndex] as { name?: string; type?: string; key?: string; nullable?: boolean; notNull?: boolean; default?: string };
    const key = col.key === 'primary' ? 'PK ' : col.key === 'foreign' ? 'FK ' : col.key === 'primary_foreign' ? 'PK,FK ' : col.key === 'unique' ? 'UK ' : '';
    const notNullSuffix = col.nullable === false || col.notNull === true ? ' NOT NULL' : '';
    const defaultSuffix = col.default ? ` DEFAULT ${col.default}` : '';
    const name = col.name ?? `column_${columnIndex + 1}`;
    const type = col.type ? ` : ${col.type}` : '';
    const initialText = `${key}${name}${type}${notNullSuffix}${defaultSuffix}`;
    const localRow = { x: padX, y: (columnIndex + 1) * layout.rowHeight, w: contentW, h: layout.rowHeight };

    const rad = (diagram.rotation ?? 0) * (Math.PI / 180);
    const centerPointX = diagram.x + diagram.w / 2, centerPointY = diagram.y + diagram.h / 2;
    const rowWorldCenter = {
      x: diagram.x + localRow.x + localRow.w / 2,
      y: diagram.y + localRow.y + localRow.h / 2,
    };
    const rowWorldRotated = rad !== 0 ? {
      x: centerPointX + (rowWorldCenter.x - centerPointX) * Math.cos(rad) - (rowWorldCenter.y - centerPointY) * Math.sin(rad),
      y: centerPointY + (rowWorldCenter.x - centerPointX) * Math.sin(rad) + (rowWorldCenter.y - centerPointY) * Math.cos(rad),
    } : rowWorldCenter;
    const sp = this.worldToClient(rowWorldRotated.x - localRow.w / 2, rowWorldRotated.y - localRow.h / 2);

    return {
      localBounds: localRow,
      clientBounds: {
        l: sp.x,
        t: sp.y,
        w: localRow.w * this.cam.zoom,
        h: localRow.h * this.cam.zoom,
      },
      fontSize: fs,
      textAlign: 'left',
      initialText,
    };
  }

  public addErTableColumn(shapeId: string, insertIndex?: number, text = 'new_column : varchar(255)'): number | null {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return null;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def || (def.id !== 'erd.er-table' && def.id !== 'erd.table' && def.id !== 'erd.view')) return null;

    const rawTable = (diagram.data?.table ?? def.defaultData?.table) as { columns?: TableColumnModel[] } | undefined;
    const columns: TableColumnModel[] = [...(rawTable?.columns ?? [])];
    const targetIdx = insertIndex !== undefined && insertIndex >= 0 && insertIndex <= columns.length ? insertIndex : columns.length;

    let remaining = text.trim();
    let key: TableColumnModel['key'] = 'none';
    let nullable = true;
    let defVal: string | undefined = undefined;

    if (/^(?:pk,?\s*fk|pfk)\s+/i.test(remaining)) {
      key = 'primary_foreign'; remaining = remaining.replace(/^(?:pk,?\s*fk|pfk)\s+/i, '').trim();
    } else if (/^pk\s+/i.test(remaining)) {
      key = 'primary'; remaining = remaining.replace(/^pk\s+/i, '').trim();
    } else if (/^fk\s+/i.test(remaining)) {
      key = 'foreign'; remaining = remaining.replace(/^fk\s+/i, '').trim();
    } else if (/^(?:uk|unique)\s+/i.test(remaining)) {
      key = 'unique'; remaining = remaining.replace(/^(?:uk|unique)\s+/i, '').trim();
    }

    const defaultMatch = remaining.match(/\s+default\s+([^\s]+)$/i);
    if (defaultMatch) {
      defVal = defaultMatch[1];
      remaining = remaining.slice(0, defaultMatch.index).trim();
    }

    if (/\s+not\s+null$/i.test(remaining)) {
      nullable = false; remaining = remaining.replace(/\s+not\s+null$/i, '').trim();
    } else if (/\s+null$/i.test(remaining)) {
      nullable = true; remaining = remaining.replace(/\s+null$/i, '').trim();
    } else if (/\s*\*\s*$/.test(remaining)) {
      nullable = false; remaining = remaining.replace(/\s*\*\s*$/, '').trim();
    }

    const colonIdx = remaining.indexOf(':');
    const name = colonIdx >= 0 ? remaining.slice(0, colonIdx).trim() : remaining;
    const type = colonIdx >= 0 ? remaining.slice(colonIdx + 1).trim() : 'varchar(255)';

    const newCol: TableColumnModel = {
      id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name || `column_${columns.length + 1}`,
      type: type || 'varchar(255)',
      key,
      nullable: key === 'primary' || key === 'primary_foreign' ? false : nullable,
      ...(defVal !== undefined ? { default: defVal } : {}),
    };

    columns.splice(targetIdx, 0, newCol);
    const neededHeight = Math.max(diagram.h, (columns.length + 1) * 32);

    this.put({
      ...diagram,
      h: neededHeight,
      data: {
        ...(diagram.data ?? {}),
        table: { ...(rawTable ?? {}), columns },
      },
    });
    this.dirty = true;
    this.saveH();
    return targetIdx;
  }

  public removeErTableColumn(shapeId: string, columnIndex: number): boolean {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return false;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def || (def.id !== 'erd.er-table' && def.id !== 'erd.table' && def.id !== 'erd.view')) return false;

    const rawTable = (diagram.data?.table ?? def.defaultData?.table) as { columns?: TableColumnModel[] } | undefined;
    const columns: TableColumnModel[] = [...(rawTable?.columns ?? [])];
    if (columnIndex < 0 || columnIndex >= columns.length) return false;

    columns.splice(columnIndex, 1);
    this.put({
      ...diagram,
      data: {
        ...(diagram.data ?? {}),
        table: { ...(rawTable ?? {}), columns },
      },
    });
    this.dirty = true;
    this.saveH();
    return true;
  }

  public updateErTableColumn(shapeId: string, columnIndex: number, text: string): boolean {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return false;
    const diagram = shape as DiagramShape;
    const def = getShapeDefinition(diagram.shapeId);
    if (!def || (def.id !== 'erd.er-table' && def.id !== 'erd.table' && def.id !== 'erd.view')) return false;

    const rawTable = (diagram.data?.table ?? def.defaultData?.table) as { columns?: TableColumnModel[] } | undefined;
    const columns: TableColumnModel[] = [...(rawTable?.columns ?? [])];
    if (columnIndex < 0 || columnIndex >= columns.length) return false;

    const oldCol = columns[columnIndex] ?? { id: `col-${Date.now()}`, name: 'column', type: 'varchar(255)' };
    let remaining = text.trim();
    let key: TableColumnModel['key'] = oldCol.key ?? 'none';
    let nullable = oldCol.nullable ?? true;
    let defVal = oldCol.default;

    if (/^(?:pk,?\s*fk|pfk)\s+/i.test(remaining)) {
      key = 'primary_foreign'; remaining = remaining.replace(/^(?:pk,?\s*fk|pfk)\s+/i, '').trim();
    } else if (/^pk\s+/i.test(remaining)) {
      key = 'primary'; remaining = remaining.replace(/^pk\s+/i, '').trim();
    } else if (/^fk\s+/i.test(remaining)) {
      key = 'foreign'; remaining = remaining.replace(/^fk\s+/i, '').trim();
    } else if (/^(?:uk|unique)\s+/i.test(remaining)) {
      key = 'unique'; remaining = remaining.replace(/^(?:uk|unique)\s+/i, '').trim();
    }

    const defaultMatch = remaining.match(/\s+default\s+([^\s]+)$/i);
    if (defaultMatch) {
      defVal = defaultMatch[1];
      remaining = remaining.slice(0, defaultMatch.index).trim();
    }

    if (/\s+not\s+null$/i.test(remaining)) {
      nullable = false; remaining = remaining.replace(/\s+not\s+null$/i, '').trim();
    } else if (/\s+null$/i.test(remaining)) {
      nullable = true; remaining = remaining.replace(/\s+null$/i, '').trim();
    } else if (/\s*\*\s*$/.test(remaining)) {
      nullable = false; remaining = remaining.replace(/\s*\*\s*$/, '').trim();
    }

    const colonIdx = remaining.indexOf(':');
    const name = colonIdx >= 0 ? remaining.slice(0, colonIdx).trim() : remaining;
    const type = colonIdx >= 0 ? remaining.slice(colonIdx + 1).trim() : (oldCol.type ?? 'varchar(255)');
    columns[columnIndex] = {
      ...oldCol,
      name: name || oldCol.name || 'column',
      type: type || 'varchar(255)',
      key,
      nullable: key === 'primary' || key === 'primary_foreign' ? false : nullable,
      ...(defVal !== undefined ? { default: defVal } : {}),
    };

    this.put({
      ...diagram,
      data: {
        ...(diagram.data ?? {}),
        table: { ...(rawTable ?? {}), columns },
      },
    });
    this.dirty = true;
    this.saveH();
    return true;
  }

  public updateUseCaseExtensionPoints(shapeId: string, text: string): boolean {
    const shape = this.shapes.get(shapeId);
    if (!shape || shape.type !== 'diagram') return false;
    const diagram = shape as DiagramShape;
    const lines = text.split('\n').map(l => l.trim().replace(/^[•\-\*]\s*/, '')).filter(Boolean);
    const existingEps = (diagram.data?.usecase as { extensionPoints?: Array<{ id: string; name: string }> } | undefined)?.extensionPoints ?? [];
    const extensionPoints = lines.map((line, idx) => ({
      id: existingEps[idx]?.id ?? `ep-${idx + 1}`,
      name: line,
      explanation: '',
    }));
    this.put({
      ...diagram,
      data: {
        ...(diagram.data ?? {}),
        usecase: {
          ...(diagram.data?.usecase ?? {}),
          version: 1,
          extensionPoints,
        },
      },
    });
    this.dirty = true;
    this.saveH();
    return true;
  }

  updateFormulaLive(id: string, source: string, lastValidPreview: string, size?: { width: number; height: number }, notify = true) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'math') return;
    const width = size && Number.isFinite(size.width) && size.width > 0 ? size.width : shape.w;
    const height = size && Number.isFinite(size.height) && size.height > 0 ? size.height : shape.h;
    if (shape.text === source && shape.previewText === lastValidPreview && shape.w === width && shape.h === height) return;
    this.put({ ...shape, text: source, previewText: lastValidPreview, w: width, h: height }, {
      redraw: id !== this.editingId,
      notify,
    });
  }

  updateFormula(id: string, source: string, lastValidPreview: string, size?: { width: number; height: number }) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'math') return;
    const width = size && Number.isFinite(size.width) && size.width > 0 ? size.width : shape.w;
    const height = size && Number.isFinite(size.height) && size.height > 0 ? size.height : shape.h;
    this.put({ ...shape, text: source, previewText: lastValidPreview, w: width, h: height });
    // Keep the edit session open for a final formula-layout measurement from the overlay.
    // The first unrelated tracked write starts a new item; undo/redo may also close it.
    this.pendingFormulaCaptureId = id;
  }

  updateCodeLive(id: string, text: string, language: CodeLanguage) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'code') return;
    this.put({ ...shape, text, language: normalizeCodeLanguage(language) });
  }

  updateCodeLayoutLive(id: string, measuredHeight: number) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'code' || shape.autoHeight === false || !Number.isFinite(measuredHeight)) return;
    const height = Math.max(1, Math.ceil(measuredHeight));
    if (height === shape.h) return;
    this.put({ ...shape, h: height, minX: shape.x, minY: shape.y, maxX: shape.x + shape.w, maxY: shape.y + height });
  }

  updateCode(id: string, text: string, language: CodeLanguage) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'code') return;
    this.put({ ...shape, text, language: normalizeCodeLanguage(language) });
    this.saveH();
  }

  deleteShape(id: string) {
    if (!this.del(id)) return;
    this.sel.delete(id);
    this.onSel?.([...this.sel]);
    this.saveH();
  }

  updateStyle(ids: string[], props: ShapeStylePatch) {
    ids.forEach(id => {
      const shape = this.shapes.get(id);
      if (!shape) return;
      let next: AnyShape;
      if (shape.type === 'connector') {
        const connector = shape as ConnectorShape;
        const definition = getShapeDefinition(connector.shapeId), capabilities = diagramCapabilitiesFor(definition);
        if (definition?.semantic?.notation === 'uml') {
          next = { ...connector,
            ...(capabilities.style.stroke && (props.color !== undefined || props.stroke !== undefined)
              ? { color: props.color ?? props.stroke } : {}),
            ...(capabilities.style.strokeWidth && props.sw !== undefined ? { sw: props.sw } : {}),
          };
        } else next = { ...connector, ...props, color: props.color ?? props.stroke ?? connector.color, sw: props.sw ?? connector.sw };
      } else if (shape.type === 'line' || shape.type === 'arrow') {
        const line = shape as LineShape | ArrowShape;
        next = { ...line, ...props, color: props.color ?? props.stroke ?? line.color, sw: props.sw ?? line.sw } as AnyShape;
      } else if (shape.type === 'diagram') {
        const diagram = shape as DiagramShape, definition = getShapeDefinition(diagram.shapeId);
        const capabilities = diagramCapabilitiesFor(definition);
        if (definition?.semantic?.notation === 'uml') {
          next = { ...diagram,
            ...(capabilities.style.fill && props.fill !== undefined ? { fill: props.fill } : {}),
            ...(capabilities.style.stroke && props.stroke !== undefined ? { stroke: props.stroke } : {}),
            ...(capabilities.style.strokeWidth && props.sw !== undefined ? { sw: props.sw } : {}),
            ...(capabilities.style.textColor && props.textColor !== undefined ? { textColor: props.textColor } : {}),
            ...(capabilities.text.editable && capabilities.style.fontSize && props.fs !== undefined && Number.isFinite(props.fs)
              ? { fs: Math.max(capabilities.text.minFontSize ?? 12, Math.min(96, props.fs)) } : {}),
          };
        } else next = { ...diagram, ...props };
        if (definition && (definition.dataCapabilities?.includes('classifier') || definition.dataCapabilities?.includes('instance')
          || definition.semantic?.family === 'uml.use-case' || definition.semantic?.family === 'uml.actor'))
          next = this.growDiagramTextBox(next as DiagramShape, (next as DiagramShape).text ?? definition.defaultText ?? definition.label,
            (next as DiagramShape).data);
      } else next = { ...shape, ...props } as AnyShape;
      this.put(next);
    });
    this.saveH();
  }


  addImage(src: string, clientX: number, clientY: number) {
    const img = new Image();
    img.onload = () => {
      const w = this.clientToWorld(clientX, clientY);
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      // cap at 800px wide if huge
      const scale = W > 800 ? 800/W : 1;
      const fw = W*scale, fh = H*scale;
      const id = uid();
      const s: ImageShape = {
        id, type:'image', src,
        x:w.x - fw/2, y:w.y - fh/2, w:fw, h:fh,
        naturalW:W, naturalH:H,
        minX:w.x-fw/2, minY:w.y-fh/2, maxX:w.x+fw/2, maxY:w.y+fh/2,
      };
      this.imgCache.set(src, img);
      this.put(s);
      this.sel.clear(); this.sel.add(id); this.onSel?.([id]);
      this.saveH();
    };
    img.src = src;
  }

  private internalClipboard: AnyShape[] = [];

  copySel(): boolean {
    const selected = [...this.sel].map(id => this.shapes.get(id)).filter(Boolean) as AnyShape[];
    if (!selected.length) return false;
    this.internalClipboard = JSON.parse(JSON.stringify(selected));
    return true;
  }

  hasInternalClipboard(): boolean {
    return this.internalClipboard.length > 0;
  }

  pasteInternal(clientX?: number, clientY?: number): string[] {
    if (!this.internalClipboard.length) return [];
    const newIds: string[] = [];
    const idMap = new Map<string, string>();
    this.internalClipboard.forEach(s => idMap.set(s.id, uid()));

    let offsetX = 24, offsetY = 24;
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      const worldMouse = this.clientToWorld(clientX, clientY);
      let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
      this.internalClipboard.forEach(s => {
        if ('x' in s && typeof s.x === 'number') {
          minX = Math.min(minX, s.x);
          minY = Math.min(minY, (s as PositionedShape).y);
        } else if ('minX' in s && typeof s.minX === 'number') {
          minX = Math.min(minX, s.minX);
          minY = Math.min(minY, s.minY);
        }
      });
      if (Number.isFinite(minX) && Number.isFinite(minY)) {
        offsetX = worldMouse.x - minX;
        offsetY = worldMouse.y - minY;
      }
    }

    const clones: AnyShape[] = this.internalClipboard.map(s => {
      const newId = idMap.get(s.id) || uid();
      newIds.push(newId);
      const clone = JSON.parse(JSON.stringify(s)) as AnyShape;
      clone.id = newId;
      if ('x' in clone && 'y' in clone && typeof clone.x === 'number' && typeof clone.y === 'number') {
        clone.x += offsetX;
        clone.y += offsetY;
        if ('minX' in clone) {
          clone.minX += offsetX;
          clone.minY += offsetY;
          clone.maxX += offsetX;
          clone.maxY += offsetY;
        }
      } else if ('x1' in clone && 'y1' in clone) {
        (clone as LineShape).x1 += offsetX;
        (clone as LineShape).y1 += offsetY;
        (clone as LineShape).x2 += offsetX;
        (clone as LineShape).y2 += offsetY;
        if ('minX' in clone) {
          clone.minX += offsetX;
          clone.minY += offsetY;
          clone.maxX += offsetX;
          clone.maxY += offsetY;
        }
      } else if ('pts' in clone && Array.isArray((clone as PenShape).pts)) {
        (clone as PenShape).pts = (clone as PenShape).pts.map(pt => [pt[0] + offsetX, pt[1] + offsetY, ...(pt.slice(2))]);
        if ('minX' in clone) {
          clone.minX += offsetX;
          clone.minY += offsetY;
          clone.maxX += offsetX;
          clone.maxY += offsetY;
        }
      }
      return clone;
    });

    this.putMany(clones);
    this.sel.clear();
    newIds.forEach(id => this.sel.add(id));
    this.onSel?.(newIds);
    this.saveH();
    return newIds;
  }

  addVideo(src: string, clientX: number, clientY: number, title?: string): string {
    const w = this.clientToWorld(clientX, clientY);
    const fw = 440, fh = 260;
    const id = uid();
    const s: VideoShape = {
      id, type: 'video', src, title,
      x: w.x - fw / 2, y: w.y - fh / 2, w: fw, h: fh,
      minX: w.x - fw / 2, minY: w.y - fh / 2, maxX: w.x + fw / 2, maxY: w.y + fh / 2,
    };
    this.put(s);
    this.sel.clear(); this.sel.add(id); this.onSel?.([id]);
    this.saveH();
    return id;
  }

  addLinkCard(url: string, clientX: number, clientY: number, initialMeta?: Partial<LinkCardShape>): string {
    const w = this.clientToWorld(clientX, clientY);
    const fw = 360, fh = 260;
    const id = uid();
    const s: LinkCardShape = {
      id, type: 'link-card', url,
      status: initialMeta?.status ?? 'loading',
      title: initialMeta?.title ?? '',
      description: initialMeta?.description ?? '',
      image: initialMeta?.image ?? '',
      favicon: initialMeta?.favicon ?? '',
      siteName: initialMeta?.siteName ?? '',
      mediaType: initialMeta?.mediaType ?? 'website',
      embedUrl: initialMeta?.embedUrl ?? '',
      x: w.x - fw / 2, y: w.y - fh / 2, w: fw, h: fh,
      minX: w.x - fw / 2, minY: w.y - fh / 2, maxX: w.x + fw / 2, maxY: w.y + fh / 2,
    };
    this.put(s);
    this.sel.clear(); this.sel.add(id); this.onSel?.([id]);
    this.saveH();
    return id;
  }

  updateLinkCardMeta(id: string, meta: Partial<LinkCardShape>): void {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'link-card') return;
    const updated: LinkCardShape = { ...shape, ...meta };
    this.put(updated);
    this.saveH();
  }

  addSticky(text: string, clientX: number, clientY: number): string {
    const w = this.clientToWorld(clientX, clientY);
    const id = uid();
    const x = w.x - 120;
    const y = w.y - 120;
    const s: StickyShape = {
      id, type: 'sticky',
      x, y, w: 240, h: 240, fs: 14,
      bg: this.style.stickyBg || '#fef08a', text,
      createdAt: formatStickyTimestamp(),
      minX: x, minY: y, maxX: x + 240, maxY: y + 240,
    };
    this.put(s);
    this.sel.clear();
    this.sel.add(id);
    this.onSel?.([id]);
    this.saveH();
    return id;
  }

  mark() { this.dirty = true; }

  getShapes() { return [...this.shapes.values()]; }

  getShape(id: string) { return this.shapes.get(id) ?? null; }

  /** Apply safe one-time UML record upgrades before observing the Y.Map or enabling local history. */
  private migrateLoadedUmlRecords() {
    const records = [...this.shapes.values()];
    const inferredContexts = inferUmlContexts(records);
    const changed: AnyShape[] = [];
    for (const shape of records) {
      const definition = this.definitionForEndpoint(shape);
      if (definition?.semantic?.notation !== 'uml') continue;
      const raw = this.yMap.get(shape.id) as unknown as Record<string, unknown> | undefined;
      const storedSchemaVersion = typeof raw?.umlSchemaVersion === 'number' && Number.isFinite(raw.umlSchemaVersion)
        ? raw.umlSchemaVersion : 0;
      const migrateLegacySequencePoints = storedSchemaVersion < 2;
      const storedContext = shape.type === 'diagram' || shape.type === 'connector' ? shape.diagramContext : undefined;
      const requested = storedContext ?? inferredContexts.get(shape.id) ?? null;
      const resolvedContext = contextForDefinition(definition, requested);
      const laneManagedConnector = shape.type === 'connector'
        && (definition.semantic?.family === 'uml.relationship-edge' || definition.semantic?.family === 'uml.usecase-dependency'
          || definition.semantic?.family === 'uml.state-edge' || definition.semantic?.family === 'uml.activity-edge');
      const parallelOrder = laneManagedConnector
        ? Number.isFinite((shape as ConnectorShape).parallelOrder)
          ? Math.max(0, Math.floor((shape as ConnectorShape).parallelOrder!)) : this.nextParallelOrder++
        : undefined;
      let next: AnyShape = {
        ...shape,
        ...(parallelOrder !== undefined ? { parallelOrder } : {}),
        umlSchemaVersion: UML_FOUNDATION_SCHEMA_VERSION,
        ...(resolvedContext ? { diagramContext: resolvedContext } : {}),
      } as AnyShape;
      if (shape.type === 'diagram') {
        let diagram = next as DiagramShape;
        const parent = diagram.containerId ? this.shapes.get(diagram.containerId) : undefined;
        diagram = this.normalizeBehavioralOwnership(diagram, diagram.containerId,
          parent?.type === 'diagram' ? parent.shapeId : undefined);
        if (['uml.entry-point', 'uml.exit-point'].includes(diagram.shapeId)
          && parent?.type === 'diagram' && parent.shapeId === 'uml.composite-state')
          diagram = this.anchorOwnedStatePoint(diagram, parent as DiagramShape, this.loadMigrationOrigin, true, false);
        const params = deriveStructuredShapeParameters(definition, diagram.data ?? {}, diagram.params ?? {});
        diagram = { ...diagram, params };
        const contentDriven = definition.dataCapabilities?.includes('classifier') || definition.dataCapabilities?.includes('instance')
          || definition.semantic?.family === 'uml.use-case' || definition.semantic?.family === 'uml.actor'
          || ['uml.state', 'uml.composite-state', 'uml.action', 'uml.object-node'].includes(diagram.shapeId);
        next = contentDriven ? this.growDiagramTextBox(diagram,
          diagram.text ?? definition.defaultText ?? definition.label, diagram.data) : diagram;
      }
      if (shape.type === 'connector') {
        const normalizeSide = (connector: ConnectorShape, side: EndpointSide): ConnectorShape => {
          const ref = side === 'source' ? connector.sourceRef : connector.targetRef;
          if (!ref) return connector;
          const owner = this.shapes.get(ref.shapeId);
          if (!owner || !isConnectableShape(owner) || !('x' in owner)) return connector;
          const point = connectionPointById(owner as BoxShape, ref.pointId);
          if (!point || (ref.kind !== undefined && ref.kind !== point.kind)) return connector;
          const stableSequenceId = migrateLegacySequencePoints
            ? persistentSequencePointId(owner as BoxShape, ref.pointId, point) : undefined;
          const stablePoint = stableSequenceId ? connectionPointById(owner as BoxShape, stableSequenceId) : undefined;
          const resolvedPoint = stablePoint ?? point;
          const nextRef = { ...ref, ...(stablePoint ? { pointId: stableSequenceId! } : {}), kind: resolvedPoint.kind };
          return side === 'source'
            ? { ...connector, x1: resolvedPoint.x, y1: resolvedPoint.y, sourceRef: nextRef }
            : { ...connector, x2: resolvedPoint.x, y2: resolvedPoint.y, targetRef: nextRef };
        };
        next = normalizeSide(next as ConnectorShape, 'source');
        next = normalizeSide(next as ConnectorShape, 'target');
        next = { ...(next as ConnectorShape), ...connectorBounds(next as ConnectorShape) };
        if (definition.semantic?.family === 'uml.sequence-edge') {
          const migratedConnector = next as ConnectorShape;
          const eventOrdinate = migratedConnector.sourceRef ? migratedConnector.y1
            : migratedConnector.targetRef ? migratedConnector.y2 : undefined;
          const storedEvent = migratedConnector.sequenceEvent;
          const hadPersistedEvent = Boolean(raw?.sequenceEvent && typeof raw.sequenceEvent === 'object');
          const visualY = hadPersistedEvent ? storedEvent?.visualY ?? eventOrdinate ?? migratedConnector.y1
            : eventOrdinate ?? storedEvent?.visualY ?? migratedConnector.sequenceTime ?? migratedConnector.y1;
          const sourceParticipantId = this.sequenceParticipantIdForEndpoint(migratedConnector.sourceRef?.shapeId);
          const targetParticipantId = this.sequenceParticipantIdForEndpoint(migratedConnector.targetRef?.shapeId);
          const sameParticipant = Boolean(sourceParticipantId && sourceParticipantId === targetParticipantId);
          const event = storedEvent ? { ...storedEvent,
            visualY: Math.round(visualY * 1000) / 1000,
            ...(migratedConnector.sourceRef ? { sourceEndpointId: migratedConnector.sourceRef.shapeId } : { sourceEndpointId: undefined }),
            ...(migratedConnector.targetRef ? { targetEndpointId: migratedConnector.targetRef.shapeId } : { targetEndpointId: undefined }),
            ...(sourceParticipantId ? { sourceParticipantId } : { sourceParticipantId: undefined }),
            ...(targetParticipantId ? { targetParticipantId } : { targetParticipantId: undefined }),
            ...(sameParticipant ? { selfCall: true, ...(storedEvent.kind === 'synchronous' ? { kind: 'self-call' as const } : {}) }
              : { selfCall: undefined, ...(storedEvent.kind === 'self-call' ? { kind: 'synchronous' as const } : {}) }),
          } : undefined;
          if (event) next = { ...migratedConnector, sequenceEvent: event,
            sequenceTime: Math.round(visualY * 1000) / 1000 };
        }
      }
      const migrated = next as unknown as Record<string, unknown>;
      const refsNeedMigration = shape.type === 'connector' && (['source', 'target'] as const).some(side => {
        const original = (raw?.[`${side}Ref`] as Record<string, unknown> | undefined);
        const normalized = (migrated[`${side}Ref`] as Record<string, unknown> | undefined);
        return Boolean(normalized && (original?.kind !== normalized.kind || original?.pointId !== normalized.pointId));
      });
      const contextChanged = resolvedContext !== storedContext;
      const needsParallelOrder = laneManagedConnector && raw?.parallelOrder !== parallelOrder;
      const needsSchema = raw?.umlSchemaVersion !== UML_FOUNDATION_SCHEMA_VERSION;
      const structuredDataNeedsWrite = shape.type === 'diagram'
        && (definition.dataCapabilities?.includes('classifier') || definition.dataCapabilities?.includes('instance')
          || resolvedContext === 'state' || resolvedContext === 'activity')
        && JSON.stringify(raw?.data ?? {}) !== JSON.stringify((next as DiagramShape).data ?? {})
        || shape.type === 'connector' && (definition.semantic?.family === 'uml.state-edge' || definition.semantic?.family === 'uml.activity-edge')
          && (JSON.stringify(raw?.stateTransition ?? null) !== JSON.stringify((next as ConnectorShape).stateTransition ?? null)
            || JSON.stringify(raw?.activityFlow ?? null) !== JSON.stringify((next as ConnectorShape).activityFlow ?? null));
      const sequenceDataNeedsWrite = shape.type === 'connector' && definition.semantic?.family === 'uml.sequence-edge'
        ? JSON.stringify(raw?.sequenceEvent ?? null) !== JSON.stringify((next as ConnectorShape).sequenceEvent ?? null)
        : shape.type === 'diagram' && (definition.semantic?.family === 'uml.sequence-participant'
          || definition.semantic?.family === 'uml.sequence-control' || definition.semantic?.family === 'uml.sequence-frame')
          ? JSON.stringify(raw?.data ?? {}) !== JSON.stringify((next as DiagramShape).data ?? {}) : false;
      const contentGeometryNeedsWrite = shape.type === 'diagram'
        && (definition.dataCapabilities?.includes('classifier') || definition.dataCapabilities?.includes('instance')
          || definition.semantic?.family === 'uml.use-case' || definition.semantic?.family === 'uml.actor'
          || ['uml.state', 'uml.composite-state', 'uml.action', 'uml.object-node'].includes(shape.shapeId))
        && (raw?.w !== (next as DiagramShape).w || raw?.h !== (next as DiagramShape).h);
      const connectorBoundsNeedWrite = shape.type === 'connector'
        && (raw?.minX !== migrated.minX || raw?.minY !== migrated.minY || raw?.maxX !== migrated.maxX || raw?.maxY !== migrated.maxY);
      if (needsSchema || refsNeedMigration || contextChanged || needsParallelOrder || structuredDataNeedsWrite
        || contentGeometryNeedsWrite || connectorBoundsNeedWrite || sequenceDataNeedsWrite) changed.push(next);
    }
    // Content migration can grow a UML box before the live engine starts observing the map.
    // Re-resolve every attached endpoint against those upgraded owner geometries in the same
    // load transaction; otherwise a legacy use-case/class label can shift a port and leave a
    // persisted connector stale until the owner is moved again.
    if (changed.length || records.some(shape => shape.type === 'connector' && shape.shapeId === 'uml.state-transition')) {
      const upgraded = new Map(records.map(shape => [shape.id, shape]));
      const changedIndex = new Map<string, number>();
      changed.forEach((shape, index) => { upgraded.set(shape.id, shape); changedIndex.set(shape.id, index); });
      const stageChanged = (shape: AnyShape) => {
        const index = changedIndex.get(shape.id);
        if (index === undefined) { changedIndex.set(shape.id, changed.length); changed.push(shape); }
        else changed[index] = shape;
        upgraded.set(shape.id, shape);
      };
      for (const original of records) {
        if (original.type !== 'connector' || original.shapeId !== 'uml.state-transition') continue;
        const current = (upgraded.get(original.id) ?? original) as ConnectorShape;
        if (!current.sourceRef || !current.targetRef) continue;
        const source = upgraded.get(current.sourceRef.shapeId), target = upgraded.get(current.targetRef.shapeId);
        if (source?.type !== 'diagram' || target?.type !== 'diagram') continue;
        const sourceRegion = (source.data?.stateVertex as { regionId?: string } | undefined)?.regionId;
        const targetRegion = (target.data?.stateVertex as { regionId?: string } | undefined)?.regionId;
        let regionId = sourceRegion === targetRegion ? sourceRegion : undefined;
        if (!regionId && target.shapeId === 'uml.entry-point') regionId = sourceRegion;
        if (!regionId && source.shapeId === 'uml.exit-point') regionId = targetRegion;
        if (!regionId && (source.shapeId === 'uml.entry-point' || source.shapeId === 'uml.exit-point'
          || target.shapeId === 'uml.entry-point' || target.shapeId === 'uml.exit-point')) regionId = sourceRegion ?? targetRegion;
        if (!regionId || current.stateTransition?.regionId === regionId) continue;
        stageChanged({ ...current, stateTransition: { ...(current.stateTransition ?? {}), regionId } });
      }
      for (const original of records) {
        if (original.type !== 'connector') continue;
        const current = (upgraded.get(original.id) ?? original) as ConnectorShape;
        let next = current, attachmentChanged = false;
        for (const side of ['source', 'target'] as const) {
          const ref = side === 'source' ? next.sourceRef : next.targetRef;
          if (!ref) continue;
          const owner = upgraded.get(ref.shapeId);
          if (!owner || !isConnectableShape(owner) || !('x' in owner)) continue;
          const point = connectionPointById(owner as BoxShape, ref.pointId);
          if (!point || (ref.kind !== undefined && ref.kind !== point.kind)) continue;
          const updatedRef = { ...ref, kind: point.kind };
          const differs = side === 'source'
            ? Math.hypot(next.x1 - point.x, next.y1 - point.y) > 1e-7 || ref.kind !== point.kind
            : Math.hypot(next.x2 - point.x, next.y2 - point.y) > 1e-7 || ref.kind !== point.kind;
          if (!differs) continue;
          attachmentChanged = true;
          next = side === 'source'
            ? { ...next, x1: point.x, y1: point.y, sourceRef: updatedRef }
            : { ...next, x2: point.x, y2: point.y, targetRef: updatedRef };
        }
        if (!attachmentChanged) continue;
        next = { ...next, ...connectorBounds(next) };
        stageChanged(next);
      }
      this.putMany(changed, { origin: this.loadMigrationOrigin, notify: false, syncAttachments: false });
    }
    for (const shape of [...this.shapes.values()]) {
      if (shape.type === 'connector' && shape.shapeId === 'uml.create-message')
        this.synchronizeSequenceCreateOwnership(shape as ConnectorShape, this.loadMigrationOrigin);
      if (shape.type === 'diagram' && getShapeDefinition(shape.shapeId)?.semantic?.connectionPointProvider === 'sequence-lifeline')
        this.synchronizeSequenceDestruction(shape as DiagramShape, this.loadMigrationOrigin);
    }
  }

  setDiagramContext(context: UMLDiagramFamily | null) {
    this.diagramContext = context;
  }

  getDiagramContext() { return this.diagramContext; }

  getSemanticContextForShape(id: string): UMLDiagramFamily | null {
    const shape = this.shapes.get(id);
    if (!shape || (shape.type !== 'diagram' && shape.type !== 'connector')) return null;
    const definition = this.definitionForEndpoint(shape);
    if (definition?.semantic?.notation !== 'uml') return null;
    if (shape.type !== 'connector')
      return shape.diagramContext ?? contextForDefinition(definition, this.diagramContext) ?? null;
    const connector = shape as ConnectorShape;
    const source = connector.sourceRef ? this.shapes.get(connector.sourceRef.shapeId) : undefined;
    const target = connector.targetRef ? this.shapes.get(connector.targetRef.shapeId) : undefined;
    return contextForConnector(definition, source ? this.definitionForEndpoint(source) : undefined,
      target ? this.definitionForEndpoint(target) : undefined, connector.diagramContext ?? this.diagramContext) ?? null;
  }

  getDiagramGraphDiagnostics(): DiagramGraphDiagnostic[] {
    const diagnostics = diagnoseUmlGraph([...this.shapes.values()]);
    for (const shape of this.shapes.values()) {
      if ((shape.type !== 'diagram' && shape.type !== 'connector') || !shape.containerId) continue;
      const definition = this.definitionForEndpoint(shape);
      if (definition?.semantic?.notation !== 'uml') continue;
      const parent = this.shapes.get(shape.containerId);
      const contained = shape.type === 'diagram' && parent?.type === 'diagram'
        ? this.diagramContains(parent as DiagramShape, shape as DiagramShape)
        : shape.type === 'connector' && parent?.type === 'diagram'
          ? this.connectorContains(parent as DiagramShape, shape as ConnectorShape) : false;
      const cycle = this.hasContainmentCycle(shape.id, shape.containerId);
      if (!contained || cycle) diagnostics.push({ id: shape.id, code: cycle ? 'container-cycle' : 'outside-container-bounds',
        severity: 'invalid', ...(shape.diagramContext ? { family: shape.diagramContext } : {}),
        message: cycle ? 'Semantic container ownership contains a cycle.' : 'Object geometry is outside its explicitly assigned container.',
        relatedIds: [shape.id, shape.containerId] });
    }
    return diagnostics;
  }

  private queueGraphDiagnostics() {
    if (!this.onGraphUpdate || this.graphNotifyQueued) return;
    this.graphNotifyQueued = true;
    queueMicrotask(() => {
      this.graphNotifyQueued = false;
      if (!this.destroyed) this.onGraphUpdate?.(this.getDiagramGraphDiagnostics());
    });
  }

  private normalizeBehavioralOwnership(
    shape: DiagramShape,
    containerId = shape.containerId,
    parentShapeId?: string,
  ): DiagramShape {
    const definition = getShapeDefinition(shape.shapeId);
    if (definition?.semantic?.notation !== 'uml') return shape;
    let context = shape.diagramContext ?? contextForDefinition(definition, this.diagramContext);
    if (parentShapeId === 'uml.composite-state') context = 'state';
    else if (parentShapeId === 'uml.activity-partition' || parentShapeId === 'uml.activity') context = 'activity';
    let data = normalizeBehavioralDiagramData(definition, shape.id, { ...(shape.data ?? {}) }, context,
      containerId, parentShapeId);
    if (context === 'state' && data.stateVertex && typeof data.stateVertex === 'object') {
      const parent = containerId ? this.shapes.get(containerId) : undefined;
      const regions = parent?.type === 'diagram' && parent.shapeId === 'uml.composite-state'
        ? (parent.data?.stateComposite as { regions?: Array<{ id?: string }> } | undefined)?.regions ?? [] : [];
      const currentRegion = (data.stateVertex as { regionId?: string }).regionId;
      const regionId = parent?.type === 'diagram' && parent.shapeId === 'uml.composite-state'
        ? regions.some(region => region.id === currentRegion) ? currentRegion! : regions[0]?.id ?? UML_STATE_FIRST_REGION_ID(parent.id)
        : UML_STATE_ROOT_REGION_ID;
      data.stateVertex = { ...(data.stateVertex as object), regionId };
    }
    if (context === 'state' && data.statePoint && typeof data.statePoint === 'object') {
      const point = { ...(data.statePoint as Record<string, unknown>) };
      if (containerId && parentShapeId === 'uml.composite-state') point.ownerStateId = containerId;
      else delete point.ownerStateId;
      data.statePoint = point;
    }
    return { ...shape, ...(context ? { diagramContext: context } : {}),
      ...(containerId ? { containerId } : { containerId: undefined }), data };
  }

  private statePointAnchor(
    composite: DiagramShape,
    point: DiagramShape,
    side: 'north' | 'east' | 'south' | 'west',
    offsetPermille: number,
  ): { x: number; y: number } {
    const offset = Math.max(0, Math.min(1000, offsetPermille)) / 1000;
    const local = side === 'north' ? { x: composite.w * offset, y: 0 }
      : side === 'east' ? { x: composite.w, y: composite.h * offset }
        : side === 'south' ? { x: composite.w * offset, y: composite.h }
          : { x: 0, y: composite.h * offset };
    const world = objectPointToWorld(composite, local);
    return { x: world.x - point.w / 2, y: world.y - point.h / 2 };
  }

  private anchorOwnedStatePoint(point: DiagramShape, composite: DiagramShape, origin: object = this,
    preserveSideAndOffset = false, write = true): DiagramShape {
    if (!['uml.entry-point', 'uml.exit-point'].includes(point.shapeId)) return point;
    const localCenter = worldPointToObject(composite, { x: point.x + point.w / 2, y: point.y + point.h / 2 });
    const metadata = point.data?.statePoint as Record<string, unknown> | undefined;
    const storedSide = ['north', 'east', 'south', 'west'].includes(String(metadata?.side))
      ? metadata!.side as 'north' | 'east' | 'south' | 'west' : undefined;
    const side = preserveSideAndOffset && storedSide ? storedSide : ([            
      { side: 'north' as const, distance: Math.abs(localCenter.y) },
      { side: 'east' as const, distance: Math.abs(localCenter.x - composite.w) },
      { side: 'south' as const, distance: Math.abs(localCenter.y - composite.h) },
      { side: 'west' as const, distance: Math.abs(localCenter.x) },
    ].sort((left, right) => left.distance - right.distance)[0]?.side ?? 'west');
    const rawOffset = side === 'north' || side === 'south'
      ? localCenter.x / Math.max(1, composite.w) * 1000
      : localCenter.y / Math.max(1, composite.h) * 1000;
    const offsetPermille = preserveSideAndOffset && typeof metadata?.offsetPermille === 'number' && storedSide === side
      ? Math.max(0, Math.min(1000, Math.round(metadata.offsetPermille)))
      : Math.max(0, Math.min(1000, Math.round(rawOffset)));
    const anchor = this.statePointAnchor(composite, point, side, offsetPermille);
    const data = { ...(point.data ?? {}), statePoint: { ...(metadata ?? {}), version: 1 as const, pointId: point.id,
      ownerStateId: composite.id, side, offsetPermille } };
    const next = { ...point, containerId: composite.id, data, x: anchor.x, y: anchor.y };
    const moved = Math.hypot(next.x - point.x, next.y - point.y) > 0.01;
    if (write && (moved || JSON.stringify(data) !== JSON.stringify(point.data ?? {})))
      this.put(next, { origin, syncAttachments: true });
    return next;
  }

  private reanchorOwnedStatePoints(compositeId: string, preserveSideAndOffset = true) {
    const composite = this.shapes.get(compositeId);
    if (composite?.type !== 'diagram' || composite.shapeId !== 'uml.composite-state') return;
    const children = [...(this.ownedIdsByContainer.get(compositeId) ?? [])];
    for (const id of children) {
      const point = this.shapes.get(id);
      if (point?.type === 'diagram' && (point.shapeId === 'uml.entry-point' || point.shapeId === 'uml.exit-point'))
        this.anchorOwnedStatePoint(point as DiagramShape, composite as DiagramShape, this, preserveSideAndOffset);
    }
  }

  private diagramContains(container: DiagramShape, child: DiagramShape): boolean {
    const containerDefinition = getShapeDefinition(container.shapeId), childDefinition = getShapeDefinition(child.shapeId);
    if (!containerDefinition || !childDefinition || !containerAcceptsSemanticChild(containerDefinition, childDefinition)) return false;
    if ((child.shapeId === 'uml.entry-point' || child.shapeId === 'uml.exit-point')
      && container.shapeId === 'uml.composite-state') {
      const point = child.data?.statePoint as Record<string, unknown> | undefined;
      if (child.containerId === container.id && point?.ownerStateId === container.id
        && ['north', 'east', 'south', 'west'].includes(String(point.side))
        && typeof point.offsetPermille === 'number') {
        const expected = this.statePointAnchor(container, child, point.side as 'north' | 'east' | 'south' | 'west', point.offsetPermille);
        return Math.hypot(expected.x - child.x, expected.y - child.y) <= 1.5;
      }
      const local = worldPointToObject(container, { x: child.x + child.w / 2, y: child.y + child.h / 2 });
      return local.x >= -child.w / 2 - 2 && local.y >= -child.h / 2 - 2
        && local.x <= container.w + child.w / 2 + 2 && local.y <= container.h + child.h / 2 + 2;
    }
    const childRole = childDefinition.semantic?.role;
    const isSequenceOwnedControl = childDefinition.semantic?.family === 'uml.sequence-control'
      && (childRole === 'activation bar' || childRole === 'lifeline destruction mark');
    if (isSequenceOwnedControl && containerDefinition.semantic?.connectionPointProvider === 'sequence-lifeline') {
      const center = worldPointToObject(container, { x: child.x + child.w / 2, y: child.y + child.h / 2 });
      const startY = sequenceParticipantHeaderHeight(containerDefinition.geometry);
      return center.x >= -1 && center.x <= container.w + 1
        && center.y >= Math.min(container.h, startY) - 1 && center.y <= container.h + 1;
    }
    let contentLeft = 0, contentTop = 0, contentRight = container.w, contentBottom = container.h;
    if (containerDefinition.geometry === 'umlBoundary' && childDefinition.semantic?.family === 'uml.use-case')
      contentTop = Math.min(container.h, UML_BOUNDARY_TITLE_HEIGHT);
    if (container.shapeId === 'uml.activity-partition') {
      const partition = container.data?.activityPartition as { orientation?: string } | undefined;
      if (partition?.orientation === 'horizontal') contentLeft = Math.min(container.w, container.w * 0.24);
      else contentTop = Math.min(container.h, container.h * 0.24);
    }
    if (container.shapeId === 'uml.activity') contentTop = Math.min(container.h, 34);
    if (container.shapeId === 'uml.composite-state' && child.diagramContext === 'state') {
      const regions = (container.data?.stateComposite as { regions?: Array<{ id?: string }> } | undefined)?.regions ?? [];
      const regionId = (child.data?.stateVertex as { regionId?: string } | undefined)?.regionId;
      const regionIndex = regions.findIndex(region => region.id === regionId);
      if (regionIndex < 0 || !regions.length) return false;
      const header = typeof container.params.stateHeaderFraction === 'number'
        ? Math.max(0.29, Math.min(0.62, container.params.stateHeaderFraction)) : 0.29;
      const contentHeight = container.h * (1 - header);
      contentTop = container.h * header + contentHeight * regionIndex / regions.length;
      contentBottom = container.h * header + contentHeight * (regionIndex + 1) / regions.length;
      contentLeft = container.w * 0.08; contentRight = container.w * 0.92;
    }
    return rotatedBoxCorners(child).every(([x, y]) => {
      const local = worldPointToObject(container, { x, y });
      return local.x >= contentLeft - 0.5 && local.y >= contentTop - 0.5
        && local.x <= contentRight + 0.5 && local.y <= contentBottom + 0.5;
    });
  }

  private containerResizeAllowed(original: DiagramShape, resized: DiagramShape): boolean {
    // Behavioral containers are semantic owners, not scale groups. Their frame can resize without
    // touching child geometry; any newly out-of-bounds child remains visible to graph diagnostics.
    if (original.shapeId === 'uml.composite-state' || original.shapeId === 'uml.activity-partition') return true;
    const directIds = this.ownedIdsByContainer.get(original.id) ?? new Set<string>();
    const directChildren = [...directIds].map(id => this.shapes.get(id))
      .filter((child): child is DiagramShape => child?.type === 'diagram');
    if (directChildren.some(child => !this.diagramContains(resized, child))) return false;
    const directConnectors = [...directIds].map(id => this.shapes.get(id))
      .filter((candidate): candidate is ConnectorShape => candidate?.type === 'connector');
    return directConnectors.every(connector => this.connectorContains(resized, connector));
  }

  private diagramIsInside(container: DiagramShape, child: DiagramShape): boolean {
    let current: DiagramShape | undefined = child;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.id === container.id || this.diagramContains(container, current)) return true;
      seen.add(current.id);
      const parent: AnyShape | DiagramShape | undefined = current.containerId
        ? this.shapes.get(current.containerId) : this.findContainingContainer(current);
      current = parent?.type === 'diagram' ? parent as DiagramShape : undefined;
    }
    return false;
  }

  private connectorContains(container: DiagramShape, connector: ConnectorShape): boolean {
    const containerDefinition = getShapeDefinition(container.shapeId), connectorDefinition = getShapeDefinition(connector.shapeId);
    if (!containerDefinition || !connectorDefinition || !containerAcceptsSemanticChild(containerDefinition, connectorDefinition)
      || !connector.sourceRef || !connector.targetRef) return false;
    const source = this.shapes.get(connector.sourceRef.shapeId), target = this.shapes.get(connector.targetRef.shapeId);
    if (!source || source.type !== 'diagram' || !target || target.type !== 'diagram') return false;
    const sequenceFragmentEdge = containerDefinition.semantic?.family === 'uml.sequence-frame'
      && connectorDefinition.semantic?.family === 'uml.sequence-edge';
    if (sequenceFragmentEdge) {
      // A combined fragment owns occurrences and message routes, not whole lifelines. Requiring
      // each participant's full box to fit inside the frame would make ordinary cross-frame
      // interactions impossible because lifelines intentionally continue beyond the fragment.
      const sourceFamily = getShapeDefinition((source as DiagramShape).shapeId)?.semantic?.family;
      const targetFamily = getShapeDefinition((target as DiagramShape).shapeId)?.semantic?.family;
      const endpointRoleAllowed = (family: string | undefined) =>
        family === 'uml.sequence-participant' || family === 'uml.sequence-control';
      if (!endpointRoleAllowed(sourceFamily) || !endpointRoleAllowed(targetFamily)) return false;
    } else if (!this.diagramIsInside(container, source as DiagramShape)
      || !this.diagramIsInside(container, target as DiagramShape)) return false;
    const route = getConnectorRoute(connector);
    if (!route.length) return false;
    return route.every(([x, y]) => {
      const local = worldPointToObject(container, { x, y });
      return local.x >= -1 && local.y >= -1 && local.x <= container.w + 1 && local.y <= container.h + 1;
    });
  }

  private normalizeSequenceOwnedControl(child: DiagramShape, parent: DiagramShape): DiagramShape {
    const childDefinition = getShapeDefinition(child.shapeId), parentDefinition = getShapeDefinition(parent.shapeId);
    const role = childDefinition?.semantic?.role;
    if (childDefinition?.semantic?.family !== 'uml.sequence-control' || !parentDefinition
      || parentDefinition.semantic?.connectionPointProvider !== 'sequence-lifeline'
      || (role !== 'activation bar' && role !== 'lifeline destruction mark')) return child;
    const local = worldPointToObject(parent, { x: child.x + child.w / 2, y: child.y + child.h / 2 });
    const lineStart = Math.min(parent.h, sequenceParticipantHeaderHeight(parentDefinition.geometry));
    const halfHeight = child.h / 2;
    const centerY = Math.max(lineStart + halfHeight, Math.min(parent.h - halfHeight, local.y));
    const center = objectPointToWorld(parent, { x: parent.w / 2, y: centerY });
    const positioned = withComputedShapeBounds({ ...child, x: center.x - child.w / 2, y: center.y - child.h / 2,
      rotation: parent.rotation ?? 0 }) as DiagramShape;
    const data = normalizeSequenceDiagramData(positioned.data ?? {}, positioned.shapeId, positioned.id,
      parent.id, positioned.h, center.y);
    if (role === 'activation bar' && data.sequenceActivation) {
      const activation = data.sequenceActivation;
      const sequenceEvents = this.sequenceEventsInTimeline(undefined);
      const startOrder = activation.startOrder ?? (sequenceEvents.length ? this.sequenceOrderBoundaryAtVisualY(positioned.y) : undefined);
      const endOrder = activation.endOrder ?? (sequenceEvents.length ? this.sequenceOrderBoundaryAtVisualY(positioned.y + positioned.h) : undefined);
      data.sequenceActivation = {
        ...activation,
        participantId: parent.id,
        duration: Math.max(1, activation.duration || positioned.h),
        ...(startOrder !== undefined ? { startOrder } : {}),
        ...(endOrder !== undefined ? { endOrder } : {}),
      };
      if (!sequenceEvents.length) {
        delete data.sequenceActivation.startOrder;
        delete data.sequenceActivation.endOrder;
      }
    } else if (role === 'lifeline destruction mark' && data.sequenceLifecycle) {
      const lifecycle = data.sequenceLifecycle;
      data.sequenceLifecycle = { ...lifecycle, participantId: parent.id, visualY: center.y,
        order: lifecycle.order ?? this.sequenceOrderAtVisualY(center.y) };
    }
    return { ...positioned, data } as DiagramShape;
  }

  private sequenceControlWithTemporalMetadata(
    shape: DiagramShape,
    updatePosition: boolean,
    updateDuration: boolean,
  ): DiagramShape {
    const definition = getShapeDefinition(shape.shapeId);
    if (definition?.semantic?.family !== 'uml.sequence-control') return shape;
    const center = objectPointToWorld(shape, { x: shape.w / 2, y: shape.h / 2 });
    const normalized = normalizeSequenceDiagramData(shape.data ?? {}, shape.shapeId, shape.id,
      shape.containerId, shape.h, center.y);
    if (shape.shapeId === 'uml.activation' && normalized.sequenceActivation) {
      const activation = normalized.sequenceActivation;
      const sequenceEvents = this.sequenceEventsInTimeline(undefined);
      const sequenceOrder = updatePosition && sequenceEvents.length ? {
        startOrder: this.sequenceOrderBoundaryAtVisualY(shape.y),
        endOrder: this.sequenceOrderBoundaryAtVisualY(shape.y + shape.h),
      } : {};
      normalized.sequenceActivation = {
        ...activation,
        ...(shape.containerId ? { participantId: shape.containerId } : {}),
        ...(updateDuration ? { duration: Math.max(1, shape.h) } : {}),
        ...sequenceOrder,
        ...(updatePosition && !sequenceEvents.length ? { startOrder: undefined, endOrder: undefined } : {}),
      };
      if (updatePosition && !sequenceEvents.length) {
        delete normalized.sequenceActivation.startOrder;
        delete normalized.sequenceActivation.endOrder;
      }
    } else if (shape.shapeId === 'uml.destroy' && normalized.sequenceLifecycle) {
      const lifecycle = normalized.sequenceLifecycle;
      normalized.sequenceLifecycle = {
        ...lifecycle,
        ...(shape.containerId ? { participantId: shape.containerId } : {}),
        visualY: Math.round(center.y * 1000) / 1000,
        ...(updatePosition ? { order: this.sequenceOrderAtVisualY(center.y) } : {}),
      };
    }
    return { ...shape, data: normalized };
  }

  private sequenceOperandForEvent(frame: DiagramShape, event: SequenceMessageEventData): string | undefined {
    const fragment = frame.data?.sequenceFragment as SequenceFragmentData | undefined;
    if (!fragment?.operands.length) return undefined;
    if (fragment.operands.length === 1) return fragment.operands[0].id;
    const local = worldPointToObject(frame, { x: frame.x + frame.w / 2, y: event.visualY });
    const contentTop = Math.min(frame.h, frame.h * 0.14);
    const contentHeight = Math.max(1, frame.h - contentTop);
    const index = Math.max(0, Math.min(fragment.operands.length - 1,
      Math.floor((local.y - contentTop) / contentHeight * fragment.operands.length)));
    return fragment.operands[index]?.id;
  }

  /** Fragment ownership is semantic and stable until an explicit containment or event move changes it. */
  private synchronizeSequenceFragmentMembership(connector: ConnectorShape, force = false): ConnectorShape {
    if (!isSequenceMessageShape(connector.shapeId) || !connector.sequenceEvent) return connector;
    const parent = connector.containerId ? this.shapes.get(connector.containerId) : undefined;
    const parentDefinition = parent?.type === 'diagram' ? getShapeDefinition(parent.shapeId) : undefined;
    const frame = parent?.type === 'diagram' && parentDefinition?.semantic?.family === 'uml.sequence-frame'
      ? parent as DiagramShape : undefined;
    if (!frame) {
      if (!force || (!connector.sequenceEvent.fragmentId && !connector.sequenceEvent.operandId)) return connector;
      const sequenceEvent = { ...connector.sequenceEvent };
      delete sequenceEvent.fragmentId;
      delete sequenceEvent.operandId;
      return { ...connector, sequenceEvent };
    }
    const fragment = frame.data?.sequenceFragment as SequenceFragmentData | undefined;
    const operandIds = new Set(fragment?.operands.map(operand => operand.id) ?? []);
    const current = connector.sequenceEvent;
    const currentOwnershipIsValid = current.fragmentId === frame.id && Boolean(current.operandId && operandIds.has(current.operandId));
    if (!force && currentOwnershipIsValid) return connector;
    const operandId = this.sequenceOperandForEvent(frame, current);
    if (!fragment || !operandId) return connector;
    const sequenceEvent = { ...current, fragmentId: frame.id, operandId };
    return { ...connector, sequenceEvent };
  }

  private synchronizeEventsInSequenceFragment(frameId: string) {
    for (const candidate of this.shapes.values()) {
      if (candidate.type !== 'connector' || getShapeDefinition(candidate.shapeId)?.semantic?.family !== 'uml.sequence-edge') continue;
      const connector = candidate as ConnectorShape;
      if (connector.containerId !== frameId && connector.sequenceEvent?.fragmentId !== frameId) continue;
      const next = this.synchronizeSequenceFragmentMembership(connector, true);
      if (JSON.stringify(next.sequenceEvent ?? null) !== JSON.stringify(connector.sequenceEvent ?? null))
        this.put(next, { notify: false, syncAttachments: false });
    }
  }

  private synchronizeSequenceDestruction(lifeline: DiagramShape, origin: object = this) {
    const definition = getShapeDefinition(lifeline.shapeId);
    if (definition?.semantic?.connectionPointProvider !== 'sequence-lifeline') return;
    const markers = [...this.shapes.values()].filter((candidate): candidate is DiagramShape => candidate.type === 'diagram'
      && candidate.shapeId === 'uml.destroy' && candidate.containerId === lifeline.id)
      .sort((left, right) => {
        const leftOrder = (left.data?.sequenceLifecycle as { order?: number } | undefined)?.order ?? Number.POSITIVE_INFINITY;
        const rightOrder = (right.data?.sequenceLifecycle as { order?: number } | undefined)?.order ?? Number.POSITIVE_INFINITY;
        return leftOrder - rightOrder || left.id.localeCompare(right.id);
      });
    const marker = markers[0];
    const params = { ...(lifeline.params ?? {}) };
    let lifecycle: SequenceLifecycleData | undefined;
    if (marker) {
      const center = objectPointToWorld(marker, { x: marker.w / 2, y: marker.h / 2 });
      const local = worldPointToObject(lifeline, center);
      const startY = Math.min(lifeline.h, sequenceParticipantHeaderHeight(definition.geometry));
      params.sequenceDestroyPermille = Math.round(Math.max(0, Math.min(1000,
        (local.y - startY) / Math.max(1, lifeline.h - startY) * 1000)));
      const normalized = normalizeSequenceDiagramData(marker.data ?? {}, marker.shapeId, marker.id,
        lifeline.id, marker.h, center.y);
      lifecycle = normalized.sequenceLifecycle ? {
        ...normalized.sequenceLifecycle,
        participantId: lifeline.id,
        visualY: Math.round(center.y * 1000) / 1000,
        order: normalized.sequenceLifecycle.order ?? this.sequenceOrderAtVisualY(center.y),
      } : undefined;
      if (lifecycle && JSON.stringify(marker.data?.sequenceLifecycle ?? null) !== JSON.stringify(lifecycle)) {
        this.put({ ...marker, data: { ...normalized, sequenceLifecycle: lifecycle } }, { notify: false, syncAttachments: false, origin });
      }
    } else {
      delete params.sequenceDestroyPermille;
    }
    const normalizedParticipant = normalizeSequenceDiagramData(lifeline.data ?? {}, lifeline.shapeId, lifeline.id,
      lifeline.containerId, lifeline.h, lifeline.y + lifeline.h / 2);
    const participant = normalizedParticipant.sequenceParticipant;
    if (participant) {
      if (marker && lifecycle) {
        participant.destroyedByEventId = lifecycle.lifecycleId;
        participant.destroyedAtOrder = lifecycle.order;
      } else {
        delete participant.destroyedByEventId;
        delete participant.destroyedAtOrder;
      }
    }
    const data = normalizedParticipant;
    const nextParticipant = {
      ...lifeline,
      params,
      data,
    };
    if (JSON.stringify(nextParticipant.params) === JSON.stringify(lifeline.params ?? {})
      && JSON.stringify(nextParticipant.data) === JSON.stringify(lifeline.data ?? {})) return;
    this.put(nextParticipant, { notify: false, origin });
  }

  private hasContainmentCycle(childId: string, containerId: string): boolean {
    let currentId: string | undefined = containerId;
    const visited = new Set<string>();
    while (currentId) {
      if (currentId === childId || visited.has(currentId)) return true;
      visited.add(currentId);
      const parent = this.shapes.get(currentId);
      currentId = parent?.type === 'diagram' ? (parent as DiagramShape).containerId : undefined;
    }
    return false;
  }

  private findAcceptedContainerAtPoint(childDefinition: ShapeDefinition, x: number, y: number): DiagramShape | undefined {
    const candidates = [...this.shapes.values()].filter((candidate): candidate is DiagramShape => {
      if (candidate.type !== 'diagram') return false;
      const container = candidate as DiagramShape, definition = getShapeDefinition(container.shapeId);
      if (!definition?.semantic?.container || !containerAcceptsSemanticChild(definition, childDefinition)) return false;
      const local = worldPointToObject(container, { x, y });
      if (local.x < 0 || local.y < 0 || local.x > container.w || local.y > container.h) return false;
      if (definition.geometry === 'umlBoundary' && childDefinition.semantic?.family === 'uml.use-case'
        && local.y < Math.min(container.h, UML_BOUNDARY_TITLE_HEIGHT)) return false;
      if (container.shapeId === 'uml.activity-partition') {
        const orientation = (container.data?.activityPartition as { orientation?: string } | undefined)?.orientation;
        if (orientation === 'horizontal' ? local.x < container.w * 0.24 : local.y < container.h * 0.24) return false;
      }
      if (container.shapeId === 'uml.composite-state' && childDefinition.semantic?.diagramFamilies?.includes('state')
        && local.y < container.h * (typeof container.params.stateHeaderFraction === 'number'
          ? Math.max(0.29, Math.min(0.62, container.params.stateHeaderFraction)) : 0.29)) return false;
      const sequenceControl = childDefinition.semantic?.family === 'uml.sequence-control'
        && definition.semantic.connectionPointProvider === 'sequence-lifeline';
      if (sequenceControl) {
        const headerHeight = sequenceParticipantHeaderHeight(definition.geometry);
        if (local.y < Math.min(container.h, headerHeight)) return false;
      }
      return true;
    });
    return candidates.sort((left, right) => left.w * left.h - right.w * right.h)[0];
  }

  private findContainingContainer(child: DiagramShape): DiagramShape | undefined {
    const candidates = [...this.shapes.values()].filter((candidate): candidate is DiagramShape => candidate.type === 'diagram'
      && candidate.id !== child.id && !this.hasContainmentCycle(child.id, candidate.id) && this.diagramContains(candidate, child));
    return candidates.sort((left, right) => left.w * left.h - right.w * right.h)[0];
  }

  private findContainingConnectorContainer(connector: ConnectorShape): DiagramShape | undefined {
    const candidates = [...this.shapes.values()].filter((candidate): candidate is DiagramShape => candidate.type === 'diagram'
      && candidate.id !== connector.id && this.connectorContains(candidate, connector));
    return candidates.sort((left, right) => left.w * left.h - right.w * right.h)[0];
  }

  private containedConnectorDescendants(containerId: string): ConnectorShape[] {
    const ownerIds = new Set([containerId, ...this.containedDescendants(containerId).map(shape => shape.id)]);
    const connectorIds = new Set<string>();
    for (const ownerId of ownerIds) for (const id of this.ownedIdsByContainer.get(ownerId) ?? []) connectorIds.add(id);
    return [...connectorIds].map(id => this.shapes.get(id))
      .filter((shape): shape is ConnectorShape => shape?.type === 'connector');
  }

  private containedDescendants(containerId: string): DiagramShape[] {
    const descendants: DiagramShape[] = [], visited = new Set<string>([containerId]), queue = [containerId];
    while (queue.length) {
      const parentId = queue.shift()!;
      for (const id of this.ownedIdsByContainer.get(parentId) ?? []) {
        if (visited.has(id)) continue;
        const candidate = this.shapes.get(id);
        if (!candidate || candidate.type !== 'diagram') continue;
        visited.add(id); descendants.push(candidate as DiagramShape); queue.push(id);
      }
    }
    return descendants;
  }

  private detachContainedChildrenFrom(containerId: string, origin: object) {
    const directIds = [...(this.ownedIdsByContainer.get(containerId) ?? [])];
    for (const id of directIds) {
      const candidate = this.shapes.get(id);
      if (!candidate || (candidate.type !== 'diagram' && candidate.type !== 'connector')) continue;
      if (candidate.type === 'diagram') {
        const next = { ...candidate } as DiagramShape & { containerId?: string };
        delete next.containerId;
        if (candidate.diagramContext === 'state') {
          const data = { ...(candidate.data ?? {}) };
          if (data.stateVertex && typeof data.stateVertex === 'object')
            data.stateVertex = { ...(data.stateVertex as UMLStateVertexData), version: 1 as const, regionId: UML_STATE_ROOT_REGION_ID };
          if (['uml.entry-point', 'uml.exit-point', 'uml.shallow-history', 'uml.deep-history'].includes(candidate.shapeId)) {
            const point = { ...(candidate.data?.statePoint as UMLStatePointData), version: 1 as const };
            delete point.ownerStateId;
            data.statePoint = point;
          }
          next.data = data;
        }
        if (candidate.diagramContext === 'activity' && candidate.shapeId !== 'uml.activity-partition') {
          const activityNode = { ...(candidate.data?.activityNode as UMLActivityNodeData), version: 1 as const };
          delete activityNode.partitionId;
          next.data = { ...(next.data ?? {}), activityNode };
        }
        this.put(next, { origin, notify: false, syncAttachments: true });
      } else {
        const next = { ...candidate } as ConnectorShape & { containerId?: string };
        delete next.containerId;
        this.put(next, { origin, notify: false });
      }
    }
  }

  private assignCreatedObjectContainer(shape: DiagramShape | ConnectorShape) {
    const live = this.shapes.get(shape.id);
    if (!live) return;
    if (live.type === 'diagram') {
      let diagram = live as DiagramShape;
      if (getShapeDefinition(diagram.shapeId)?.semantic?.family === 'uml.sequence-control') {
        diagram = this.sequenceControlWithTemporalMetadata(diagram, true, diagram.shapeId === 'uml.activation');
        this.put(diagram, { notify: false, syncAttachments: false });
      }
      const parent = this.findContainingContainer(diagram);
      if (!parent) return;
      let next: DiagramShape = { ...diagram, containerId: parent.id };
      next = this.normalizeSequenceOwnedControl(next, parent);
      next = this.normalizeBehavioralOwnership(next, parent.id, parent.shapeId);
      this.put(next, { syncAttachments: true });
      if (['uml.entry-point', 'uml.exit-point'].includes(next.shapeId) && parent.shapeId === 'uml.composite-state')
        next = this.anchorOwnedStatePoint(next, parent);
      if (diagram.shapeId === 'uml.destroy') this.synchronizeSequenceDestruction(parent);
    } else if (live.type === 'connector') {
      const connector = live as ConnectorShape;
      const parent = this.findContainingConnectorContainer(connector);
      if (parent) {
        const owned = this.synchronizeSequenceFragmentMembership({ ...connector, containerId: parent.id } as ConnectorShape, true);
        this.put(owned, { notify: false });
      }
    }
  }

  /** Containers available for a deliberate reparent action; no pointer-up inference is performed. */
  getContainerCandidates(childId: string): DiagramShape[] {
    const child = this.shapes.get(childId);
    if (!child || (child.type !== 'diagram' && child.type !== 'connector')) return [];
    return [...this.shapes.values()].filter((candidate): candidate is DiagramShape => candidate.type === 'diagram'
      && candidate.id !== childId
      && (child.type === 'diagram'
        ? !this.hasContainmentCycle(childId, candidate.id) && this.diagramContains(candidate, child as DiagramShape)
        : this.connectorContains(candidate, child as ConnectorShape)))
      .sort((left, right) => left.w * left.h - right.w * right.h || left.id.localeCompare(right.id));
  }

  /** Explicit semantic containment. Detach, reparent, and move-between-containers are deliberate. */
  setShapeContainer(childId: string, containerId: string | null, commit = true): boolean {
    const child = this.shapes.get(childId);
    if (!child || (child.type !== 'diagram' && child.type !== 'connector')) return false;
    const previousId = child.containerId;
    if (containerId === previousId) return true;
    if (containerId === null) {
      let next = { ...child } as AnyShape & { containerId?: string };
      delete next.containerId;
      if (child.type === 'diagram')
        next = this.normalizeBehavioralOwnership(next as DiagramShape, undefined, undefined);
      const unowned = child.type === 'connector'
        ? this.synchronizeSequenceFragmentMembership(next as ConnectorShape, true) : next as AnyShape;
      this.put(unowned as AnyShape, { syncAttachments: child.type === 'diagram' });
      const oldParent = previousId ? this.shapes.get(previousId) : undefined;
      if (child.type === 'diagram' && child.shapeId === 'uml.destroy' && oldParent?.type === 'diagram')
        this.synchronizeSequenceDestruction(oldParent as DiagramShape);
      if (commit) this.saveH();
      return true;
    }
    const parent = this.shapes.get(containerId);
    if (!parent || parent.type !== 'diagram') return false;
    let next: AnyShape;
    if (child.type === 'diagram') {
      if (this.hasContainmentCycle(childId, containerId) || !this.diagramContains(parent as DiagramShape, child as DiagramShape)) return false;
      let diagram = this.normalizeSequenceOwnedControl({ ...(child as DiagramShape), containerId }, parent as DiagramShape);
      diagram = this.normalizeBehavioralOwnership(diagram, containerId, (parent as DiagramShape).shapeId);
      next = diagram;
    } else {
      if (!this.connectorContains(parent as DiagramShape, child as ConnectorShape)) return false;
      next = this.synchronizeSequenceFragmentMembership({ ...(child as ConnectorShape), containerId } as ConnectorShape, true);
    }
    this.put(next, { syncAttachments: child.type === 'diagram' });
    if (child.type === 'diagram' && ['uml.entry-point', 'uml.exit-point'].includes(child.shapeId)
      && (parent as DiagramShape).shapeId === 'uml.composite-state')
      this.anchorOwnedStatePoint(next as DiagramShape, parent as DiagramShape);
    const oldParent = previousId ? this.shapes.get(previousId) : undefined;
    if (child.type === 'diagram' && child.shapeId === 'uml.destroy') {
      if (oldParent?.type === 'diagram') this.synchronizeSequenceDestruction(oldParent as DiagramShape);
      this.synchronizeSequenceDestruction(parent as DiagramShape);
    }
    if (commit) this.saveH();
    return true;
  }

  getConnectionPoints(id: string) {
    const shape = this.shapes.get(id);
    return shape && isConnectableShape(shape) && 'x' in shape
      ? connectionPointsForBox(shape as BoxShape)
      : [];
  }

  private definitionForEndpoint(shape: AnyShape): ShapeDefinition | undefined {
    if (shape.type === 'diagram' || shape.type === 'connector') return getShapeDefinition(shape.shapeId);
    return getShapeDefinitionForLegacyType(shape.type);
  }

  private sequenceParticipantIdForEndpoint(endpointId?: string): string | undefined {
    if (!endpointId) return undefined;
    const endpoint = this.shapes.get(endpointId);
    if (!endpoint || endpoint.type !== 'diagram') return undefined;
    const definition = getShapeDefinition(endpoint.shapeId);
    if (definition?.semantic?.family === 'uml.sequence-participant') return endpoint.id;
    if (definition?.semantic?.family === 'uml.sequence-control' && endpoint.containerId) {
      const owner = this.shapes.get(endpoint.containerId);
      return owner?.type === 'diagram' && getShapeDefinition(owner.shapeId)?.semantic?.family === 'uml.sequence-participant'
        ? owner.id : undefined;
    }
    return undefined;
  }

  private behavioralEdgeFamily(connectorDefinition: ShapeDefinition | undefined): 'uml.activity-edge' | 'uml.state-edge' | undefined {
    const family = connectorDefinition?.semantic?.family;
    return family === 'uml.activity-edge' || family === 'uml.state-edge' ? family : undefined;
  }

  private behavioralFlowCount(nodeId: string, family: 'uml.activity-edge' | 'uml.state-edge', side: 'source' | 'target', excludingId?: string): number {
    const node = this.shapes.get(nodeId);
    if (!node || !('minX' in node)) return 0;
    const nearby = this.rtree.search({ minX: node.minX - 4, minY: node.minY - 4, maxX: node.maxX + 4, maxY: node.maxY + 4 });
    const familyContext = family === 'uml.state-edge' ? 'state' : 'activity';
    return nearby.filter(candidate => candidate.type === 'connector' && candidate.id !== excludingId
      && this.definitionForEndpoint(candidate)?.semantic?.family === family
      && this.getSemanticContextForShape(candidate.id) === familyContext
      && (side === 'source' ? (candidate as ConnectorShape).sourceRef?.shapeId
        : (candidate as ConnectorShape).targetRef?.shapeId) === nodeId).length;
  }

  private behavioralEndpointContextAllowed(connectorDefinition: ShapeDefinition | undefined, node: AnyShape): boolean {
    const family = this.behavioralEdgeFamily(connectorDefinition);
    if (!family) return true;
    const expected = family === 'uml.state-edge' ? 'state' : 'activity';
    const actual = this.getSemanticContextForShape(node.id);
    return actual === null || actual === expected;
  }

  private behavioralEndpointCapacityAllowed(
    connectorDefinition: ShapeDefinition | undefined, node: AnyShape, side: 'source' | 'target', excludingId?: string,
  ): boolean {
    const family = this.behavioralEdgeFamily(connectorDefinition);
    if (!family || node.type !== 'diagram') return true;
    const context = this.getSemanticContextForShape(node.id);
    if (family === 'uml.state-edge' && context !== 'state' || family === 'uml.activity-edge' && context !== 'activity') return true;
    const policyRecord = node as unknown as import('./shapes/statePolicy').BehavioralPolicyRecord;
    const limits = family === 'uml.state-edge' ? StatePolicy.flowRule(policyRecord) : ActivityPolicy.flowRule(policyRecord);
    if (!limits) return true;
    const maximum = side === 'source' ? limits.maxOutgoing : limits.maxIncoming;
    if (maximum === undefined) return true;
    return this.behavioralFlowCount(node.id, family, side, excludingId) < maximum;
  }

  /** Backward-compatible summary backed by the centralized context-aware graph diagnostics. */
  getBehavioralGraphIssues(): string[] {
    return this.getDiagramGraphDiagnostics().filter(issue => issue.family === 'activity' || issue.family === 'state')
      .map(issue => `${issue.id}: ${issue.message}`);
  }

  private connectionPointCandidates(
    x: number, y: number, excludeId: string, connectorDefinition: ShapeDefinition | undefined,
    side: EndpointSide, options: { includeIncompatible?: boolean; maxDistance?: number; onlyShapeId?: string; sequenceTime?: number } = {},
  ): Array<{ point: ShapeConnectionPoint; shapeId: string; definition: ShapeDefinition | undefined; distance: number }> {
    const threshold = 16 / Math.max(0.04, this.cam.zoom);
    const maxDistance = options.maxDistance ?? threshold;
    const candidates: Array<{ point: ShapeConnectionPoint; shapeId: string; definition: ShapeDefinition | undefined; distance: number }> = [];
    const nearbyShapes = options.onlyShapeId
      ? [this.shapes.get(options.onlyShapeId)].filter((shape): shape is AnyShape => Boolean(shape))
      : Number.isFinite(maxDistance)
        ? this.rtree.search({ minX: x - maxDistance, minY: y - maxDistance, maxX: x + maxDistance, maxY: y + maxDistance })
        : [...this.shapes.values()];
    for (const shape of nearbyShapes) {
      if (shape.id === excludeId || !isConnectableShape(shape) || !('x' in shape)) continue;
      const definition = this.definitionForEndpoint(shape);
      if (!options.includeIncompatible && connectorDefinition
        && (!connectorEndpointSideAllowed(connectorDefinition, definition, side)
          || !this.behavioralEndpointContextAllowed(connectorDefinition, shape)
          || !this.behavioralEndpointCapacityAllowed(connectorDefinition, shape, side, excludeId))) continue;
      const provider = definition?.semantic?.connectionPointProvider;
      const points = connectionPointsForBox(shape as BoxShape, { x, y });
      const isCreateMessage = connectorDefinition?.id === 'uml.create-message' && side === 'target';
      const activeConnector = this.shapes.get(excludeId);
      const oppositeRef = activeConnector?.type === 'connector'
        ? side === 'source' ? activeConnector.targetRef : activeConnector.sourceRef : undefined;
      const oppositeParticipantId = oppositeRef ? this.sequenceParticipantIdForEndpoint(oppositeRef.shapeId) : undefined;
      const sameParticipantLoop = Boolean(oppositeParticipantId
        && oppositeParticipantId === this.sequenceParticipantIdForEndpoint(shape.id));
      const pointSequenceTime = sameParticipantLoop ? y : options.sequenceTime;
      let usablePoints: ShapeConnectionPoint[] = provider === 'sequence-lifeline'
        ? points.filter(point => point.id.startsWith('lifeline-time:') || point.id.startsWith('lifeline:')
          || (isCreateMessage && point.id === 'participant:create'))
        : points;
      if ((provider === 'sequence-lifeline' || provider === 'sequence-activation')
        && pointSequenceTime !== undefined && !isCreateMessage) {
        usablePoints = connectionPointsAtSequenceTime(shape as BoxShape, pointSequenceTime);
      }
      if (isCreateMessage) usablePoints = points.filter(point => point.id === 'participant:create');
      let best: typeof candidates[number] | null = null;
      for (const point of usablePoints) {
        if (connectorDefinition?.connectorRule && connectorDefinition.connectorRule !== 'generic' && point.id === 'center') continue;
        const distance = (provider === 'sequence-lifeline' || provider === 'sequence-activation')
          && options.sequenceTime !== undefined ? Math.abs(point.x - x) : Math.hypot(point.x - x, point.y - y);
        const prefersStructuredRow = provider === 'structured-table-rows' && point.id.startsWith('table-row:')
          && best && !best.point.id.startsWith('table-row:') && Math.abs(distance - best.distance) <= 0.01;
        const prefersFloating = point.kind === 'floating' && best && best.point.kind !== 'floating'
          && Math.abs(distance - best.distance) <= 0.01;
        if (distance <= maxDistance && (!best || distance < best.distance - 0.01 || prefersStructuredRow || prefersFloating))
          best = { point, shapeId: shape.id, definition, distance };
      }
      if (best) candidates.push(best);
    }
    return candidates.sort((a, b) => a.distance - b.distance || a.shapeId.localeCompare(b.shapeId) || a.point.id.localeCompare(b.point.id));
  }

  private sequenceTimeForConnector(connector: ConnectorShape, movingSide: EndpointSide): number | undefined {
    if (getShapeDefinition(connector.shapeId)?.semantic?.family !== 'uml.sequence-edge') return undefined;
    const ordinate = movingSide === 'target' && connector.sequenceEvent?.selfCall
      ? connector.sequenceEvent.targetVisualY ?? connector.sequenceEvent.visualY
      : connector.sequenceEvent?.visualY ?? connector.sequenceTime ?? (movingSide === 'source' ? connector.y2 : connector.y1);
    return Number.isFinite(ordinate) ? ordinate : undefined;
  }

  private sequenceAttachmentAtTime(reference: NonNullable<ConnectorShape['sourceRef']>, visualY: number) {
    const owner = this.shapes.get(reference.shapeId);
    if (!owner || !isConnectableShape(owner) || !('x' in owner)) return undefined;
    const provider = this.definitionForEndpoint(owner)?.semantic?.connectionPointProvider;
    if (provider !== 'sequence-lifeline' && provider !== 'sequence-activation') return undefined;
    const preferredSide = reference.pointId.includes(':right:') || reference.pointId.startsWith('activation:right:') ? 'right'
      : reference.pointId.includes(':left:') || reference.pointId.startsWith('activation:left:') ? 'left' : undefined;
    const atOwner = connectionPointsAtSequenceTime(owner as BoxShape, visualY);
    const point = preferredSide ? atOwner.find(item => item.id.includes(`:${preferredSide}:`)) : atOwner[0];
    if (point) return reference.kind === undefined || reference.kind === point.kind ? { ownerId: owner.id, point } : undefined;
    if (provider !== 'sequence-activation' || owner.type !== 'diagram' || !owner.containerId) return undefined;
    const participant = this.shapes.get(owner.containerId);
    if (participant?.type !== 'diagram'
      || getShapeDefinition(participant.shapeId)?.semantic?.connectionPointProvider !== 'sequence-lifeline') return undefined;
    const fallback = connectionPointsAtSequenceTime(participant as BoxShape, visualY)[0];
    return fallback && (reference.kind === undefined || reference.kind === fallback.kind)
      ? { ownerId: participant.id, point: fallback } : undefined;
  }

  private sequenceEventsInTimeline(timelineId: string | undefined, excludingId?: string): ConnectorShape[] {
    return [...this.shapes.values()].filter((candidate): candidate is ConnectorShape => candidate.type === 'connector'
      && candidate.id !== excludingId && isSequenceMessageShape(candidate.shapeId) && Boolean(candidate.sequenceEvent)
      && candidate.sequenceEvent?.timelineId === timelineId);
  }

  /** Assign a logical order token at an intentional event-placement Y; geometry is never the stored order. */
  private sequenceOrderAtVisualY(
    visualY: number, timelineId?: string, excludingIds?: string | ReadonlySet<string>,
  ): number {
    const events = this.sequenceEventsInTimeline(timelineId).filter(candidate =>
      typeof excludingIds === 'string' ? candidate.id !== excludingIds : !excludingIds?.has(candidate.id))
      .sort((left, right) => left.sequenceEvent!.visualY - right.sequenceEvent!.visualY
        || compareSequenceEvents(left.sequenceEvent!, right.sequenceEvent!));
    const parallel = events.find(candidate => Math.abs(candidate.sequenceEvent!.visualY - visualY) <= 1.25);
    if (parallel) return parallel.sequenceEvent!.order;
    const previous = events.filter(candidate => candidate.sequenceEvent!.visualY < visualY).at(-1)?.sequenceEvent;
    const following = events.find(candidate => candidate.sequenceEvent!.visualY > visualY)?.sequenceEvent;
    if (!previous && !following) return 1024;
    if (!previous) return following!.order - 1024;
    if (!following) return previous.order + 1024;
    if (following.order - previous.order > 1e-6) return (previous.order + following.order) / 2;

    // Rare floating-point exhaustion: rebalance only this timeline's order tokens, not its layout.
    let order = 0;
    let lastY: number | undefined;
    let lastOrder = 0;
    for (const candidate of events) {
      const event = candidate.sequenceEvent!;
      if (lastY === undefined || Math.abs(event.visualY - lastY) > 1.25) order += 1024;
      else order = lastOrder;
      if (event.order !== order) {
        const next = { ...candidate, sequenceEvent: { ...event, order } };
        this.put(next, { notify: false, syncAttachments: false });
      }
      lastY = event.visualY; lastOrder = order;
    }
    const rebased = this.sequenceEventsInTimeline(timelineId).filter(candidate =>
      typeof excludingIds === 'string' ? candidate.id !== excludingIds : !excludingIds?.has(candidate.id))
      .sort((left, right) => left.sequenceEvent!.visualY - right.sequenceEvent!.visualY
        || compareSequenceEvents(left.sequenceEvent!, right.sequenceEvent!));
    const after = rebased.filter(candidate => candidate.sequenceEvent!.visualY < visualY).at(-1)?.sequenceEvent;
    const before = rebased.find(candidate => candidate.sequenceEvent!.visualY > visualY)?.sequenceEvent;
    return after && before ? (after.order + before.order) / 2 : after ? after.order + 1024 : before ? before.order - 1024 : 1024;
  }

  /** Logical activation boundary tokens interpolate existing events without ever rewriting them. */
  private sequenceOrderBoundaryAtVisualY(visualY: number): number | undefined {
    const events = this.sequenceEventsInTimeline(undefined)
      .sort((left, right) => left.sequenceEvent!.visualY - right.sequenceEvent!.visualY
        || compareSequenceEvents(left.sequenceEvent!, right.sequenceEvent!));
    if (!events.length) return undefined;
    const parallel = events.find(candidate => Math.abs(candidate.sequenceEvent!.visualY - visualY) <= 1.25);
    if (parallel) return parallel.sequenceEvent!.order;
    const previous = events.filter(candidate => candidate.sequenceEvent!.visualY < visualY).at(-1)?.sequenceEvent;
    const following = events.find(candidate => candidate.sequenceEvent!.visualY > visualY)?.sequenceEvent;
    if (!previous) return following!.order - 1024;
    if (!following) return previous.order + 1024;
    return following.order - previous.order > 1e-6 ? (previous.order + following.order) / 2 : previous.order;
  }

  private synchronizeSequenceActivationRanges() {
    const eventsExist = this.sequenceEventsInTimeline(undefined).length > 0;
    for (const candidate of this.shapes.values()) {
      if (candidate.type !== 'diagram' || candidate.shapeId !== 'uml.activation') continue;
      const activation = (candidate as DiagramShape).data?.sequenceActivation;
      if (!activation) continue;
      const nextActivation = { ...activation };
      if (eventsExist) {
        const startOrder = this.sequenceOrderBoundaryAtVisualY(candidate.y);
        const endOrder = this.sequenceOrderBoundaryAtVisualY(candidate.y + candidate.h);
        if (startOrder !== undefined) nextActivation.startOrder = startOrder;
        if (endOrder !== undefined) nextActivation.endOrder = endOrder;
      } else {
        delete nextActivation.startOrder; delete nextActivation.endOrder;
      }
      if (JSON.stringify(nextActivation) !== JSON.stringify(activation))
        this.put({ ...candidate, data: { ...(candidate as DiagramShape).data, sequenceActivation: nextActivation } as DiagramShape['data'] },
          { notify: false, syncAttachments: false });
    }
  }

  private sequenceEventWithEndpoint(
    connector: ConnectorShape,
    side: EndpointSide,
    endpointId: string | undefined,
    visualY = connector.sequenceEvent?.visualY ?? connector.sequenceTime ?? connector.y1,
    endpointY = visualY,
  ): SequenceMessageEventData | undefined {
    if (!isSequenceMessageShape(connector.shapeId) || !connector.sequenceEvent) return connector.sequenceEvent;
    const event = { ...connector.sequenceEvent, visualY: Math.round(visualY * 1000) / 1000 };
    const participantId = this.sequenceParticipantIdForEndpoint(endpointId);
    if (side === 'source') {
      if (endpointId) { event.sourceEndpointId = endpointId; } else delete event.sourceEndpointId;
      if (participantId) event.sourceParticipantId = participantId; else delete event.sourceParticipantId;
    } else {
      if (endpointId) { event.targetEndpointId = endpointId; } else delete event.targetEndpointId;
      if (participantId) event.targetParticipantId = participantId; else delete event.targetParticipantId;
    }
    const sameParticipant = Boolean(event.sourceParticipantId && event.sourceParticipantId === event.targetParticipantId);
    const baseKind = sequenceMessageKindForShape(connector.shapeId);
    event.selfCall = sameParticipant || undefined;
    if (side === 'target' && sameParticipant) event.targetVisualY = Math.round(endpointY * 1000) / 1000;
    else if (!sameParticipant) delete event.targetVisualY;
    else if (!event.targetVisualY) event.targetVisualY = Math.round((visualY + 24) * 1000) / 1000;
    if (baseKind === 'synchronous') event.kind = sameParticipant ? 'self-call' : 'synchronous';
    else if (baseKind) event.kind = baseKind;
    return event;
  }

  /** Synchronize a create message with exactly the participant it creates; never infer from x/y. */
  private synchronizeSequenceCreateOwnership(connector: ConnectorShape, origin: object = this) {
    if (connector.shapeId !== 'uml.create-message' || !connector.sequenceEvent) return;
    const targetId = connector.targetRef?.pointId === 'participant:create'
      ? this.sequenceParticipantIdForEndpoint(connector.targetRef.shapeId) : undefined;
    for (const candidate of this.shapes.values()) {
      if (candidate.type !== 'diagram' || getShapeDefinition(candidate.shapeId)?.semantic?.family !== 'uml.sequence-participant') continue;
      const participant = candidate as DiagramShape;
      const current = participant.data?.sequenceParticipant as Record<string, unknown> | undefined;
      const isCurrentOwner = current?.createdByMessageId === connector.id;
      const shouldOwn = participant.id === targetId;
      if (!isCurrentOwner && !shouldOwn) continue;
      const sequenceParticipant = { ...(current ?? {}), version: 1 as const, participantId: participant.id } as unknown as SequenceParticipantData;
      if (shouldOwn) {
        sequenceParticipant.createdByMessageId = connector.id;
        sequenceParticipant.createdAtOrder = connector.sequenceEvent.order;
      } else {
        delete sequenceParticipant.createdByMessageId;
        delete sequenceParticipant.createdAtOrder;
      }
      const data = { ...(participant.data ?? {}), sequenceParticipant };
      if (JSON.stringify(data) !== JSON.stringify(participant.data ?? {}))
        this.put({ ...participant, data }, { notify: false, syncAttachments: false, origin });
    }
  }

  /** Move one interaction vertically as an intentional temporal edit; attached owners stay latched. */
  private moveSequenceMessageGesture(origin: ConnectorShape, dx: number, dy: number): ConnectorShape {
    if (!origin.sequenceEvent) return moveShape(origin, origin.x1 + dx, origin.y1 + dy) as ConnectorShape;
    // A create event attached to the new lifeline head follows that lifecycle anchor, not a free Y.
    const createAnchored = origin.shapeId === 'uml.create-message' && origin.targetRef?.pointId === 'participant:create';
    const temporalDy = createAnchored ? 0 : dy;
    const visualY = Math.round((origin.sequenceEvent.visualY + temporalDy) * 1000) / 1000;
    const targetY = origin.sequenceEvent.selfCall
      ? Math.round(((origin.sequenceEvent.targetVisualY ?? origin.sequenceEvent.visualY) + temporalDy) * 1000) / 1000 : visualY;
    const moved = moveShape(origin, origin.x1 + dx, origin.y1 + temporalDy) as ConnectorShape;
    const resolve = (reference: NonNullable<ConnectorShape['sourceRef']>, desiredY: number) => {
      if (reference.pointId !== 'participant:create') return this.sequenceAttachmentAtTime(reference, desiredY);
      const owner = this.shapes.get(reference.shapeId);
      if (!owner || !isConnectableShape(owner) || !('x' in owner)) return undefined;
      const point = connectionPointById(owner as BoxShape, reference.pointId);
      return point ? { ownerId: owner.id, point } : undefined;
    };
    const source = origin.sourceRef ? resolve(origin.sourceRef, visualY) : undefined;
    const target = origin.targetRef ? resolve(origin.targetRef, targetY) : undefined;
    // If a requested time falls outside the connected lifelines, keep the event intact rather than
    // leaving attached geometry detached from its owner.
    if ((origin.sourceRef && !source) || (origin.targetRef && !target)) return origin;
    let next: ConnectorShape = { ...moved,
      ...(source ? { x1: source.point.x, y1: source.point.y,
        sourceRef: { ...origin.sourceRef!, shapeId: source.ownerId, pointId: source.point.id, kind: source.point.kind } } : {}),
      ...(target ? { x2: target.point.x, y2: target.point.y,
        targetRef: { ...origin.targetRef!, shapeId: target.ownerId, pointId: target.point.id, kind: target.point.kind } } : {}),
    };
    let sequenceEvent = this.sequenceEventWithEndpoint(next, 'source', next.sourceRef?.shapeId, visualY, source?.point.y ?? next.y1);
    if (sequenceEvent) next = { ...next, sequenceEvent };
    sequenceEvent = this.sequenceEventWithEndpoint(next, 'target', next.targetRef?.shapeId, visualY, target?.point.y ?? next.y2);
    if (sequenceEvent) {
      if (Math.abs(temporalDy) >= 0.001)
        sequenceEvent.order = this.sequenceOrderAtVisualY(visualY, sequenceEvent.timelineId, origin.id);
      next = { ...next, sequenceEvent, sequenceTime: visualY };
    }
    if (Math.abs(temporalDy) >= 0.001) next = this.synchronizeSequenceFragmentMembership(next, true);
    return { ...next, ...connectorBounds(next) };
  }

  private endpointCandidateIsValid(
    connector: ConnectorShape, side: EndpointSide,
    candidate: { shapeId: string; definition: ShapeDefinition | undefined },
  ): boolean {
    const definition = getShapeDefinition(connector.shapeId);
    const owner = this.shapes.get(candidate.shapeId);
    if (!definition || !owner || !connectorEndpointSideAllowed(definition, candidate.definition, side)
      || !this.behavioralEndpointContextAllowed(definition, owner)
      || !this.behavioralEndpointCapacityAllowed(definition, owner, side, connector.id)) return false;
    const oppositeRef = side === 'source' ? connector.targetRef : connector.sourceRef;
    const opposite = oppositeRef ? this.shapes.get(oppositeRef.shapeId) : undefined;
    const oppositeDefinition = opposite ? this.definitionForEndpoint(opposite) : undefined;
    if (!oppositeDefinition) return true; // the other end is intentionally free or already diagnosed as broken
    return side === 'source'
      ? connectorEndpointPairAllowed(definition, candidate.definition, oppositeDefinition)
      : connectorEndpointPairAllowed(definition, oppositeDefinition, candidate.definition);
  }

  private updateConnectorTargetFeedback(connector: ConnectorShape, x: number, y: number, side: EndpointSide = 'target') {
    const definition = getShapeDefinition(connector.shapeId);
    const sequenceTime = this.sequenceTimeForConnector(connector, side);
    const candidates = this.connectionPointCandidates(x, y, connector.id, definition, side,
      { includeIncompatible: true, ...(sequenceTime !== undefined ? { sequenceTime } : {}) });
    const invalidLatchedSource = Boolean(this.connectorSourceFeedback && !this.connectorSourceFeedback.valid);
    const ranked = candidates.map(candidate => ({ candidate,
      valid: !invalidLatchedSource && this.endpointCandidateIsValid(connector, side, candidate) }))
      .sort((left, right) => Number(right.valid) - Number(left.valid)
        || left.candidate.distance - right.candidate.distance
        || left.candidate.shapeId.localeCompare(right.candidate.shapeId));
    const best = ranked[0];
    if (!best) {
      if (this.connectorTargetFeedback) { this.connectorTargetFeedback = null; this.dirty = true; }
      return;
    }
    const next = { shapeId: best.candidate.shapeId,
      point: { x: best.candidate.point.x, y: best.candidate.point.y }, valid: best.valid };
    const previous = this.connectorTargetFeedback;
    if (previous?.shapeId !== next.shapeId || previous.valid !== next.valid
      || Math.hypot(previous.point.x - next.point.x, previous.point.y - next.point.y) > 0.5) {
      this.connectorTargetFeedback = next;
      this.dirty = true;
    }
  }

  private synchronizeStateTransitionRegion(connector: ConnectorShape): ConnectorShape {
    if (connector.shapeId !== 'uml.state-transition' || !connector.sourceRef || !connector.targetRef) return connector;
    const source = this.shapes.get(connector.sourceRef.shapeId), target = this.shapes.get(connector.targetRef.shapeId);
    if (source?.type !== 'diagram' || target?.type !== 'diagram'
      || this.getSemanticContextForShape(source.id) !== 'state' || this.getSemanticContextForShape(target.id) !== 'state') return connector;
    const sourceRegion = (source.data?.stateVertex as { regionId?: string } | undefined)?.regionId;
    const targetRegion = (target.data?.stateVertex as { regionId?: string } | undefined)?.regionId;
    let regionId = sourceRegion === targetRegion ? sourceRegion : undefined;
    if (!regionId && target.shapeId === 'uml.entry-point') regionId = sourceRegion;
    if (!regionId && source.shapeId === 'uml.exit-point') regionId = targetRegion;
    if (!regionId && (source.shapeId === 'uml.entry-point' || source.shapeId === 'uml.exit-point'
      || target.shapeId === 'uml.entry-point' || target.shapeId === 'uml.exit-point')) regionId = sourceRegion ?? targetRegion;
    if (!regionId) return connector;
    const stateTransition = { ...(connector.stateTransition ?? {}), regionId };
    return JSON.stringify(stateTransition) === JSON.stringify(connector.stateTransition ?? {})
      ? connector : { ...connector, stateTransition };
  }

  /** Commit exactly one endpoint; the opposite reference, intent, and coordinates are untouched. */
  private snapConnectorEndpoint(connector: ConnectorShape, side: EndpointSide) {
    const definition = getShapeDefinition(connector.shapeId);
    if (!definition) return;
    const x = side === 'source' ? connector.x1 : connector.x2;
    const y = side === 'source' ? connector.y1 : connector.y2;
    const sequenceTime = this.sequenceTimeForConnector(connector, side);
    const candidates = this.connectionPointCandidates(x, y, connector.id, definition, side,
      { includeIncompatible: true, ...(sequenceTime !== undefined ? { sequenceTime } : {}) });
    const chosen = candidates.map(candidate => ({ candidate, valid: this.endpointCandidateIsValid(connector, side, candidate) }))
      .filter(item => item.valid)
      .sort((left, right) => left.candidate.distance - right.candidate.distance
        || left.candidate.shapeId.localeCompare(right.candidate.shapeId)
        || left.candidate.point.id.localeCompare(right.candidate.point.id))[0]?.candidate;
    const invalidEndpointRefs = { ...(connector.invalidEndpointRefs ?? {}) };
    delete invalidEndpointRefs[side];
    let next: ConnectorShape = { ...connector, invalidEndpointRefs: Object.keys(invalidEndpointRefs).length ? invalidEndpointRefs : undefined };
    if (chosen) {
      const ref = { shapeId: chosen.shapeId, pointId: chosen.point.id, kind: chosen.point.kind };
      if (side === 'source') {
        next.x1 = chosen.point.x; next.y1 = chosen.point.y; next.sourceRef = ref; next.sourceIntent = 'attached';
      } else {
        next.x2 = chosen.point.x; next.y2 = chosen.point.y; next.targetRef = ref; next.targetIntent = 'attached';
      }
    } else if (side === 'source') {
      next.sourceRef = undefined; next.sourceIntent = 'free';
    } else {
      next.targetRef = undefined; next.targetIntent = 'free';
    }
    if (definition.semantic?.family === 'uml.sequence-edge') {
      const createHeaderTarget = definition.id === 'uml.create-message' && side === 'target'
        && chosen?.point.id === 'participant:create';
      const eventOrdinate = createHeaderTarget ? chosen!.point.y
        : next.sourceRef ? next.y1 : next.targetRef ? next.y2 : next.sequenceEvent?.visualY ?? next.sequenceTime ?? next.y1;
      const visualY = Math.round(eventOrdinate * 1000) / 1000;
      if (createHeaderTarget && next.sourceRef) {
        const owner = this.shapes.get(next.sourceRef.shapeId);
        const sourcePoint = owner && isConnectableShape(owner) && 'x' in owner
          ? connectionPointsAtSequenceTime(owner as BoxShape, visualY)[0] : undefined;
        if (sourcePoint) {
          next.x1 = sourcePoint.x; next.y1 = sourcePoint.y;
          next.sourceRef = { ...next.sourceRef, pointId: sourcePoint.id, kind: sourcePoint.kind };
        }
      }
      let sequenceEvent = this.sequenceEventWithEndpoint(next, side, chosen?.shapeId, visualY,
        side === 'source' ? next.y1 : next.y2);
      if (sequenceEvent) {
        sequenceEvent.order = this.sequenceOrderAtVisualY(visualY, sequenceEvent.timelineId, connector.id);
        next = { ...next, sequenceTime: visualY, sequenceEvent };
      }
    }
    next = this.synchronizeStateTransitionRegion(next);
    this.put({ ...next, ...connectorBounds(next) }, { notify: false, syncAttachments: false });
    this.synchronizeSequenceCreateOwnership(next);
    if (definition.semantic?.family === 'uml.sequence-edge') this.synchronizeSequenceActivationRanges();
    this.rebalanceParallelConnectorLanes();
    if (this.connectorTargetFeedback) { this.connectorTargetFeedback = null; this.dirty = true; }
  }

  private latchConnectorSource(connector: ConnectorShape, x: number, y: number) {
    const definition = getShapeDefinition(connector.shapeId);
    const hit = this.hitShape(x, y);
    const hitOwner = hit && isConnectableShape(hit) ? hit : undefined;
    const nearbyCandidates = this.connectionPointCandidates(x, y, connector.id, definition, 'source',
      { includeIncompatible: true });
    const canStartAt = (candidate: { shapeId: string; definition: ShapeDefinition | undefined }) => {
      const owner = this.shapes.get(candidate.shapeId);
      return Boolean(definition && owner && connectorEndpointSideAllowed(definition, candidate.definition, 'source')
        && this.behavioralEndpointContextAllowed(definition, owner)
        && this.behavioralEndpointCapacityAllowed(definition, owner, 'source', connector.id));
    };
    // Selection hit-testing deliberately has an 8px halo. At tight Class gaps it can report a
    // neighboring classifier even though the pointer is exactly on the other classifier's port.
    // Rank all nearby legal ports by distance in that case, rather than allowing the halo to
    // steal the latched source. Preserve direct invalid/capacity feedback when the hit shape itself
    // has a port inside snap range; use the old in-shape fallback for body clicks away from ports.
    const hitOwnerHasNearbyPort = Boolean(hitOwner && nearbyCandidates.some(candidate => candidate.shapeId === hitOwner.id));
    let candidates = nearbyCandidates;
    if (hitOwner && hitOwnerHasNearbyPort && !canStartAt({
      shapeId: hitOwner.id, definition: this.definitionForEndpoint(hitOwner),
    })) {
      candidates = nearbyCandidates.filter(candidate => candidate.shapeId === hitOwner.id);
    } else if (!nearbyCandidates.some(canStartAt) && hitOwner) {
      candidates = this.connectionPointCandidates(x, y, connector.id, definition, 'source', {
        includeIncompatible: true, maxDistance: Number.POSITIVE_INFINITY, onlyShapeId: hitOwner.id,
      });
    }
    const validCandidates = candidates.filter(canStartAt);
    const candidate = validCandidates[0];
    if (!candidate) {
      const incompatible = candidates[0];
      this.connectorSourceFeedback = incompatible
        ? { shapeId: incompatible.shapeId, point: { x: incompatible.point.x, y: incompatible.point.y }, valid: false } : null;
      this.put({ ...connector, sourceIntent: 'free', targetIntent: 'pending' }, { notify: false, syncAttachments: false });
      return;
    }
    this.connectorSourceFeedback = null;
    const sourceRef = { shapeId: candidate.shapeId, pointId: candidate.point.id, kind: candidate.point.kind };
    let next: ConnectorShape = { ...connector,
      x1: candidate.point.x, y1: candidate.point.y, sourceRef, sourceIntent: 'attached', targetIntent: 'pending',
    };
    if (definition?.semantic?.family === 'uml.sequence-edge') {
      const visualY = Math.round(candidate.point.y * 1000) / 1000;
      const sequenceEvent = this.sequenceEventWithEndpoint(next, 'source', candidate.shapeId, visualY);
      if (sequenceEvent) {
        sequenceEvent.order = this.sequenceOrderAtVisualY(visualY, sequenceEvent.timelineId, connector.id);
        next = { ...next, sequenceTime: visualY, sequenceEvent };
      }
    }
    this.put({ ...next, ...connectorBounds(next) }, { notify: false, syncAttachments: false });
  }

  private rebalanceParallelConnectorLanes() {
    type LaneEntry = { connector: ConnectorShape; orientation: 1 | -1 };
    const groups = new Map<string, LaneEntry[]>();
    const clear: ConnectorShape[] = [];
    for (const shape of this.shapes.values()) {
      if (shape.type !== 'connector') continue;
      const connector = shape as ConnectorShape, definition = this.definitionForEndpoint(connector);
      const family = this.behavioralEdgeFamily(definition);
      const isSequenceEdge = definition?.semantic?.family === 'uml.sequence-edge';
      const sequence = connector.sequenceEvent;
      const semanticContext = this.getSemanticContextForShape(connector.id);
      const isClassRelation = definition?.semantic?.family === 'uml.relationship-edge' && semanticContext === 'class';
      const isUseCaseRelation = (definition?.semantic?.family === 'uml.relationship-edge'
        || definition?.semantic?.family === 'uml.usecase-dependency') && semanticContext === 'use-case';
      if ((!family && !isSequenceEdge && !isClassRelation && !isUseCaseRelation) || !connector.sourceRef || !connector.targetRef) {
        if (connector.parallelLane !== undefined) clear.push(connector);
        continue;
      }
      const sourceId = isSequenceEdge ? sequence?.sourceParticipantId ?? connector.sourceRef.shapeId : connector.sourceRef.shapeId;
      const targetId = isSequenceEdge ? sequence?.targetParticipantId ?? connector.targetRef.shapeId : connector.targetRef.shapeId;
      let key: string, orientation: 1 | -1 = 1;
      if (isSequenceEdge) {
        // All messages at the same explicit occurrence order share one routing group, not just
        // repeated messages between the same pair. Fan-out/fan-in events otherwise draw over one
        // another from their shared participant and become impossible to pick reliably.
        key = `uml.sequence|${sequence?.timelineId ?? ''}|${sequence?.order ?? 0}`;
        const source = this.shapes.get(sourceId), target = this.shapes.get(targetId);
        const sourceX = source && isPositionedShape(source) ? source.x + source.w / 2 : connector.x1;
        const targetX = target && isPositionedShape(target) ? target.x + target.w / 2 : connector.x2;
        orientation = sourceId === targetId || sourceX <= targetX ? 1 : -1;
      } else if ((isClassRelation || isUseCaseRelation) && definition?.semantic?.role === 'association') {
        const [first, second] = [sourceId, targetId].sort((left, right) => left.localeCompare(right));
        key = `uml.${isClassRelation ? 'class' : 'use-case'}.association|${first}|${second}`;
        orientation = sourceId === first ? 1 : -1;
      } else {
        key = `${family ?? 'uml.class.relation'}|${sourceId}|${targetId}`;
      }
      const group = groups.get(key) ?? [];
      group.push({ connector, orientation }); groups.set(key, group);
    }
    for (const connector of clear) {
      const next = { ...connector, parallelLane: undefined };
      this.put({ ...next, ...connectorBounds(next) }, { notify: false });
    }
    for (const group of groups.values()) {
      const ownsUmlRelationOrder = group.every(({ connector }) => {
        const relationFamily = this.definitionForEndpoint(connector)?.semantic?.family;
        return connector.parallelOrder !== undefined
          && (relationFamily === 'uml.relationship-edge' || relationFamily === 'uml.usecase-dependency');
      });
      const ownsStableBehaviorOrder = group.every(({ connector }) => {
        const edgeFamily = this.definitionForEndpoint(connector)?.semantic?.family;
        return connector.parallelOrder !== undefined && (edgeFamily === 'uml.state-edge' || edgeFamily === 'uml.activity-edge');
      });
      if (ownsUmlRelationOrder || ownsStableBehaviorOrder) {
        // Persistent Class/Use Case relation order is semantic and never derives from random IDs.
        group.sort((left, right) => (left.connector.parallelOrder ?? 0) - (right.connector.parallelOrder ?? 0));
      } else if (group.every(({ connector }) => getShapeDefinition(connector.shapeId)?.semantic?.family === 'uml.sequence-edge')) {
        const laneKey = (connector: ConnectorShape) => {
          const event = connector.sequenceEvent;
          const centerX = (participantId: string | undefined, fallback: number) => {
            const owner = participantId ? this.shapes.get(participantId) : undefined;
            return owner && isPositionedShape(owner) ? owner.x + owner.w / 2 : fallback;
          };
          return {
            sourceX: centerX(event?.sourceParticipantId, connector.x1),
            targetX: centerX(event?.targetParticipantId, connector.x2),
            targetY: event?.targetVisualY ?? event?.visualY ?? connector.y2,
            kind: event?.kind ?? '', shapeId: connector.shapeId, label: connector.label ?? '',
            // Only exact geometric/semantic ties need an identity tie-breaker; event order itself
            // remains explicit numeric data and is never inferred from this stable routing key.
            eventId: event?.eventId ?? '',
          };
        };
        group.sort((left, right) => {
          const a = laneKey(left.connector), b = laneKey(right.connector);
          return a.sourceX - b.sourceX || a.targetX - b.targetX || a.targetY - b.targetY
            || a.kind.localeCompare(b.kind) || a.shapeId.localeCompare(b.shapeId)
            || a.label.localeCompare(b.label) || a.eventId.localeCompare(b.eventId);
        });
      } else {
        // Preserve pre-existing State/Activity lane ordering behavior outside this pass.
        group.sort((left, right) => left.connector.id.localeCompare(right.connector.id));
      }
      group.forEach(({ connector, orientation }, index) => {
        const lane = group.length > 1 ? (index - (group.length - 1) / 2) * orientation : undefined;
        if (connector.parallelLane === lane) return;
        const next = { ...connector, parallelLane: lane };
        this.put({ ...next, ...connectorBounds(next) }, { notify: false });
      });
    }
  }

  private updateAttachedConnectors(shapeId: string, origin: object = this) {
    const target = this.shapes.get(shapeId);
    if (!target || !isConnectableShape(target) || !('x' in target)) return;
    const attachedIds = [...(this.connectorIdsByEndpoint.get(shapeId) ?? [])];
    for (const connectorId of attachedIds) {
      const candidate = this.shapes.get(connectorId);
      if (candidate?.type !== 'connector') continue;
      const connector = candidate as ConnectorShape;
      const sourceAffected = connector.sourceRef?.shapeId === shapeId;
      const targetAffected = connector.targetRef?.shapeId === shapeId;
      if (!sourceAffected && !targetAffected) continue;
      const isSequence = getShapeDefinition(connector.shapeId)?.semantic?.family === 'uml.sequence-edge';
      const createTargetMovesEvent = isSequence && connector.shapeId === 'uml.create-message'
        && targetAffected && connector.targetRef?.pointId === 'participant:create';
      const targetCreatePoint = createTargetMovesEvent
        ? connectionPointById(target as BoxShape, 'participant:create') : undefined;
      const eventY = createTargetMovesEvent ? targetCreatePoint?.y
        : connector.sequenceEvent?.visualY ?? connector.sequenceTime ?? connector.y1;
      const resolve = (reference: NonNullable<ConnectorShape['sourceRef']>, desiredY: number) => {
        const owner = this.shapes.get(reference.shapeId);
        if (!owner || !isConnectableShape(owner) || !('x' in owner)) return undefined;
        if (isSequence && Number.isFinite(desiredY) && reference.pointId !== 'participant:create') {
          const provider = this.definitionForEndpoint(owner)?.semantic?.connectionPointProvider;
          if (provider === 'sequence-lifeline' || provider === 'sequence-activation')
            return this.sequenceAttachmentAtTime(reference, desiredY);
        }
        const point = connectionPointById(owner as BoxShape, reference.pointId);
        if (!point || (reference.kind !== undefined && reference.kind !== point.kind)) return undefined;
        return { ownerId: owner.id, point };
      };
      const sourceY = Number.isFinite(eventY) ? eventY! : connector.y1;
      const targetY = connector.sequenceEvent?.selfCall
        ? connector.sequenceEvent.targetVisualY ?? sourceY : sourceY;
      const source = connector.sourceRef
        ? isSequence ? resolve(connector.sourceRef, sourceY) : sourceAffected ? resolve(connector.sourceRef, connector.y1) : undefined
        : undefined;
      const end = connector.targetRef
        ? isSequence ? resolve(connector.targetRef, targetY) : targetAffected ? resolve(connector.targetRef, connector.y2) : undefined
        : undefined;
      if (!source && !end) continue;
      const invalidEndpointRefs = { ...(connector.invalidEndpointRefs ?? {}) };
      if (source) delete invalidEndpointRefs.source;
      if (end) delete invalidEndpointRefs.target;
      let next: ConnectorShape = { ...connector,
        ...(source ? { x1: source.point.x, y1: source.point.y,
          sourceRef: { ...connector.sourceRef!, shapeId: source.ownerId, pointId: source.point.id, kind: source.point.kind }, sourceIntent: 'attached' as const } : {}),
        ...(end ? { x2: end.point.x, y2: end.point.y,
          targetRef: { ...connector.targetRef!, shapeId: end.ownerId, pointId: end.point.id, kind: end.point.kind }, targetIntent: 'attached' as const } : {}),
        invalidEndpointRefs: Object.keys(invalidEndpointRefs).length ? invalidEndpointRefs : undefined,
      };
      if (getShapeDefinition(connector.shapeId)?.semantic?.family === 'uml.state-edge')
        next = this.synchronizeStateTransitionRegion(next);
      if (isSequence) {
        const visualY = Math.round(sourceY * 1000) / 1000;
        let sequenceEvent = this.sequenceEventWithEndpoint(next, 'source', next.sourceRef?.shapeId, visualY, source?.point.y ?? sourceY);
        if (sequenceEvent) next = { ...next, sequenceEvent };
        sequenceEvent = this.sequenceEventWithEndpoint(next, 'target', next.targetRef?.shapeId, visualY, end?.point.y ?? targetY);
        if (sequenceEvent) next = { ...next, sequenceEvent, sequenceTime: visualY };
      }
      this.put({ ...next, ...connectorBounds(next) }, { notify: false, syncAttachments: false, origin });
      if (isSequence) this.synchronizeSequenceCreateOwnership(next);
    }
  }

  private detachConnectorsFrom(shapeId: string, origin: object = this) {
    const removedShape = this.shapes.get(shapeId);
    const removedDefinition = removedShape ? this.definitionForEndpoint(removedShape) : undefined;
    const removesParticipant = removedDefinition?.semantic?.family === 'uml.sequence-participant';
    const attachedIds = [...(this.connectorIdsByEndpoint.get(shapeId) ?? [])];
    for (const connectorId of attachedIds) {
      const candidate = this.shapes.get(connectorId);
      if (candidate?.type !== 'connector') continue;
      const connector = candidate as ConnectorShape;
      const sourceRemoved = connector.sourceRef?.shapeId === shapeId;
      const targetRemoved = connector.targetRef?.shapeId === shapeId;
      if (!sourceRemoved && !targetRemoved) continue;
      const invalidEndpointRefs = { ...(connector.invalidEndpointRefs ?? {}) };
      if (sourceRemoved) delete invalidEndpointRefs.source;
      if (targetRemoved) delete invalidEndpointRefs.target;
      let sequenceEvent = connector.sequenceEvent ? { ...connector.sequenceEvent } : undefined;
      if (sequenceEvent && getShapeDefinition(connector.shapeId)?.semantic?.family === 'uml.sequence-edge') {
        if (sourceRemoved) {
          delete sequenceEvent.sourceEndpointId;
          if (removesParticipant) delete sequenceEvent.sourceParticipantId;
        }
        if (targetRemoved) {
          delete sequenceEvent.targetEndpointId;
          if (removesParticipant) delete sequenceEvent.targetParticipantId;
        }
        const sameParticipant = Boolean(sequenceEvent.sourceParticipantId
          && sequenceEvent.sourceParticipantId === sequenceEvent.targetParticipantId);
        sequenceEvent.selfCall = sameParticipant || undefined;
        if (!sameParticipant) {
          delete sequenceEvent.targetVisualY;
          if (sequenceEvent.kind === 'self-call') sequenceEvent.kind = 'synchronous';
        } else if (!sequenceEvent.targetVisualY) sequenceEvent.targetVisualY = sequenceEvent.visualY + 24;
      }
      const next: ConnectorShape = { ...connector,
        sourceRef: sourceRemoved ? undefined : connector.sourceRef,
        targetRef: targetRemoved ? undefined : connector.targetRef,
        ...(sourceRemoved ? { sourceIntent: 'free' as const } : {}),
        ...(targetRemoved ? { targetIntent: 'free' as const } : {}),
        ...(sequenceEvent ? { sequenceEvent } : {}),
        invalidEndpointRefs: Object.keys(invalidEndpointRefs).length ? invalidEndpointRefs : undefined,
      };
      this.put({ ...next, ...connectorBounds(next) }, { notify: false, origin, syncAttachments: false });
      if (getShapeDefinition(next.shapeId)?.semantic?.family === 'uml.sequence-edge')
        this.synchronizeSequenceCreateOwnership(next, origin);
    }
  }

  updateShapeParameters(id: string, params: Record<string, unknown>, commit = true) {
    const shape = this.shapes.get(id);
    if (!shape || !('x' in shape) || !('w' in shape)) return;
    const definition = shape.type === 'diagram' ? getShapeDefinition((shape as DiagramShape).shapeId)
      : getShapeDefinitionForLegacyType(shape.type);
    if (!definition) return;
    const editablePatch = normalizeShapeParameterPatch(definition, params);
    if (!Object.keys(editablePatch).length) return;
    const existingParams = 'params' in shape ? shape.params ?? {} : {};
    let next = { ...shape, params: { ...existingParams, ...editablePatch } } as AnyShape;
    if (next.type === 'diagram' && (definition.dataCapabilities?.includes('classifier') || definition.dataCapabilities?.includes('instance')
      || definition.semantic?.family === 'uml.use-case' || definition.semantic?.family === 'uml.actor')) {
      const diagram = next as DiagramShape;
      next = this.growDiagramTextBox(diagram, diagram.text ?? definition.defaultText ?? definition.label, diagram.data);
    }
    this.put(next);
    if (commit) this.saveH();
  }

  /** Update true local XYZ dimension factors without altering board position or outer rotation. */
  updateShapeScale3d(id: string, patch: Partial<Solid3DScale>, commit = true) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'diagram') return;
    const diagram = shape as DiagramShape;
    const definition = getShapeDefinition(diagram.shapeId);
    if (!definition?.solid3d) return;
    const geometry = definition.geometry as Solid3DGeometry;
    const current = normalizeSolid3DScale(geometry, diagram.scale3d ?? definition.defaultScale3d
      ?? solid3DScaleFromBounds(diagram.w, diagram.h, definition.width, definition.height, geometry));
    const safe = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0.01, Math.min(64, value)) : fallback;
    let scale3d: Solid3DScale = { x: safe(patch.x, current.x), y: safe(patch.y, current.y), z: safe(patch.z, current.z) };
    for (const axis of ['x', 'y', 'z'] as const) {
      const group = solid3DSizeGroup(geometry, axis);
      const edited = group.find(key => patch[key] !== undefined);
      if (edited) {
        const value = safe(patch[edited], current[edited]);
        group.forEach(key => { scale3d[key] = value; });
      }
    }
    scale3d = normalizeSolid3DScale(geometry, scale3d);
    if (scale3d.x === current.x && scale3d.y === current.y && scale3d.z === current.z) return;
    const beforeBounds = localSolidProjectedBounds(diagram);
    const afterBounds = localSolidProjectedBounds({ ...diagram, scale3d });
    const beforeWidth = Math.max(1, beforeBounds.maxX - beforeBounds.minX);
    const beforeHeight = Math.max(1, beforeBounds.maxY - beforeBounds.minY);
    const afterWidth = Math.max(1, afterBounds.maxX - afterBounds.minX);
    const afterHeight = Math.max(1, afterBounds.maxY - afterBounds.minY);
    const embeddedTextScale = resizeDiagramEmbeddedTextScale({ ...diagram, w: beforeWidth, h: beforeHeight }, afterWidth, afterHeight);
    this.put({ ...diagram, scale3d, embeddedTextScale });
    if (commit) this.saveH();
  }

  updateDiagramData(id: string, patch: Record<string, unknown>, commit = true) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'diagram') return;
    const diagram = shape as DiagramShape;
    const definition = getShapeDefinition(diagram.shapeId);
    const mergedData = { ...(definition?.defaultData ?? {}), ...(diagram.data ?? {}), ...patch };
    let data = definition?.semantic?.notation === 'uml'
      ? normalizeUmlStructuredData(definition, mergedData, mergedData) : mergedData;
    if (definition?.semantic?.notation === 'uml') {
      const parent = diagram.containerId ? this.shapes.get(diagram.containerId) : undefined;
      data = normalizeBehavioralDiagramData(definition, diagram.id, data,
        this.getSemanticContextForShape(diagram.id) ?? diagram.diagramContext,
        diagram.containerId, parent?.type === 'diagram' ? parent.shapeId : undefined);
      data = normalizeUseCaseDiagramData(definition, data);
    }
    if (definition?.semantic?.family?.startsWith('uml.sequence-') || diagram.shapeId === 'uml.frame')
      data = normalizeSequenceDiagramData(data, diagram.shapeId, diagram.id, diagram.containerId, diagram.h, diagram.y + diagram.h / 2);
    const params = definition ? deriveStructuredShapeParameters(definition, data, diagram.params) : diagram.params;
    const updated = this.growDiagramTextBox({ ...diagram, data, params }, diagram.text ?? '', data);
    this.put(updated);
    if (diagram.shapeId === 'uml.frame') this.synchronizeEventsInSequenceFragment(diagram.id);
    if (commit) this.saveH();
  }

  updateDiagramBehavioralRole(id: string, role: BehavioralNodeRole): boolean {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'diagram') return false;
    const diagram = shape as DiagramShape, definition = getShapeDefinition(diagram.shapeId);
    if (!definition?.semantic?.behavioralNodeRoles?.includes(role) || diagram.behavioralRole === role) return false;
    const next = { ...diagram, behavioralRole: role };
    const proposed = [...this.shapes.values()].map(candidate => candidate.id === id ? next : candidate);
    if (diagnoseUmlGraph(proposed).some(issue => issue.severity === 'invalid' && issue.relatedIds.includes(id))) return false;
    this.put(next);
    this.saveH();
    return true;
  }

  updateDiagramContext(id: string, context: UMLDiagramFamily | null, commit = true): boolean {
    const shape = this.shapes.get(id);
    if (!shape || (shape.type !== 'diagram' && shape.type !== 'connector')) return false;
    const definition = this.definitionForEndpoint(shape);
    if (definition?.semantic?.notation !== 'uml'
      || (context !== null && !(definition.semantic.diagramFamilies ?? []).includes(context))) return false;
    const next = { ...shape, diagramContext: context ?? undefined } as AnyShape;
    const proposed = [...this.shapes.values()].map(candidate => candidate.id === id ? next : candidate);
    if (diagnoseUmlGraph(proposed).some(issue => issue.severity === 'invalid' && issue.relatedIds.includes(id))) return false;
    this.put(next as AnyShape);
    if (commit) this.saveH();
    return true;
  }

  updateConnectorProperties(id: string, properties: Partial<Pick<ConnectorShape, 'lineStyle' | 'startMarker' | 'endMarker'
    | 'sourceCardinality' | 'targetCardinality' | 'sourceMultiplicity' | 'targetMultiplicity' | 'label' | 'stateTransition' | 'activityFlow' | 'usecaseExtend'
    | 'labelPosition' | 'labelOffset' | 'sourceLabel' | 'targetLabel' | 'sourceLabelPosition' | 'sourceLabelOffset'
    | 'targetLabelPosition' | 'targetLabelOffset'>>, commit = true): boolean {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'connector') return false;
    const definition = getShapeDefinition(shape.shapeId);
    const capabilities = diagramCapabilitiesFor(definition, this.getSemanticContextForShape(id));
    let next: ConnectorShape = { ...shape };
    if (definition?.semantic?.notation === 'uml') {
      const connectorCaps = capabilities.connector ?? {};
      if (connectorCaps.lineStyleEditable && properties.lineStyle !== undefined) next.lineStyle = properties.lineStyle;
      if (connectorCaps.markersEditable) {
        if (properties.startMarker !== undefined) next.startMarker = properties.startMarker;
        if (properties.endMarker !== undefined) next.endMarker = properties.endMarker;
      }
      if (connectorCaps.cardinalityEditable) {
        if (properties.sourceCardinality !== undefined) next.sourceCardinality = properties.sourceCardinality;
        if (properties.targetCardinality !== undefined) next.targetCardinality = properties.targetCardinality;
      }
      if (connectorCaps.multiplicityEditable) {
        if (properties.sourceMultiplicity !== undefined) next.sourceMultiplicity = properties.sourceMultiplicity.slice(0, 200_000);
        if (properties.targetMultiplicity !== undefined) next.targetMultiplicity = properties.targetMultiplicity.slice(0, 200_000);
      }
      if (connectorCaps.sourceLabelEditable && properties.sourceLabel !== undefined) next.sourceLabel = properties.sourceLabel.slice(0, 200_000);
      if (connectorCaps.targetLabelEditable && properties.targetLabel !== undefined) next.targetLabel = properties.targetLabel.slice(0, 200_000);
      if (connectorCaps.labelMode === 'plain' && properties.label !== undefined) next.label = properties.label.slice(0, 200_000);
      if (connectorCaps.labelMode === 'structured' && properties.stateTransition !== undefined
        && definition?.id === 'uml.state-transition') {
        next.stateTransition = properties.stateTransition;
        next.label = '';
      }
      if (connectorCaps.labelMode === 'structured' && properties.activityFlow !== undefined
        && (definition?.id === 'uml.activity-flow' || definition?.id === 'uml.object-flow')) {
        next.activityFlow = normalizeActivityFlowData(properties.activityFlow, definition.id);
      }
      if (properties.usecaseExtend !== undefined && definition?.id === 'uml.extend') {
        next.usecaseExtend = normalizeExtendRelationshipData(properties.usecaseExtend);
      }
      if (connectorCaps.labelPositionEditable && properties.labelPosition !== undefined)
        next.labelPosition = Math.round(Math.max(0, Math.min(1000, properties.labelPosition)));
      if (connectorCaps.labelPositionEditable && properties.labelOffset !== undefined)
        next.labelOffset = Math.round(Math.max(-2000, Math.min(2000, properties.labelOffset)));
      if (connectorCaps.labelPositionEditable && connectorCaps.sourceLabelEditable) {
        if (properties.sourceLabelPosition !== undefined) next.sourceLabelPosition = Math.round(Math.max(0, Math.min(1000, properties.sourceLabelPosition)));
        if (properties.sourceLabelOffset !== undefined) next.sourceLabelOffset = Math.round(Math.max(-2000, Math.min(2000, properties.sourceLabelOffset)));
      }
      if (connectorCaps.labelPositionEditable && connectorCaps.targetLabelEditable) {
        if (properties.targetLabelPosition !== undefined) next.targetLabelPosition = Math.round(Math.max(0, Math.min(1000, properties.targetLabelPosition)));
        if (properties.targetLabelOffset !== undefined) next.targetLabelOffset = Math.round(Math.max(-2000, Math.min(2000, properties.targetLabelOffset)));
      }
    } else {
      next = { ...next, ...properties } as ConnectorShape;
    }
    if (JSON.stringify(next) === JSON.stringify(shape)) return false;
    this.put({ ...next, ...connectorBounds(next) }, { syncAttachments: false });
    if (commit) this.saveH();
    return true;
  }

  addConnectorWaypoint(id: string, x: number, y: number, index?: number) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'connector' || !Number.isFinite(x) || !Number.isFinite(y) || shape.waypoints.length >= 32) return;
    const waypoints = shape.waypoints.map(point => [point[0], point[1]] as [number, number]);
    const insertAt = Math.max(0, Math.min(waypoints.length, index ?? waypoints.length));
    waypoints.splice(insertAt, 0, [x, y]);
    const next = { ...shape, waypoints };
    this.put({ ...next, ...connectorBounds(next) }); this.saveH();
  }

  removeConnectorWaypoint(id: string, index: number) {
    const shape = this.shapes.get(id);
    if (!shape || shape.type !== 'connector' || !Number.isInteger(index) || index < 0 || index >= shape.waypoints.length) return;
    const next = { ...shape, waypoints: shape.waypoints.filter((_, waypointIndex) => waypointIndex !== index) };
    this.put({ ...next, ...connectorBounds(next) }); this.saveH();
  }

  private reassertRemoteDeletions() {
    const resurrected = [...this.remoteDeletedKeys].filter(id => this.yMap.has(id));
    if (!resurrected.length) return;
    this.transactMap(() => resurrected.forEach(id => this.yMap.delete(id)), this.remoteRepairOrigin);
  }

  undo() {
    if (!this.undoManager.canUndo()) return;
    this.pendingFormulaCaptureId = null;
    this.undoManager.stopCapturing();
    this.undoManager.undo();
    // Y.UndoManager protects remote map writes but can restore a value after a peer's map delete.
    // Reapply only those latest externally deleted keys, without adding a local history item.
    this.reassertRemoteDeletions();
  }

  redo() {
    if (!this.undoManager.canRedo()) return;
    this.pendingFormulaCaptureId = null;
    this.undoManager.stopCapturing();
    this.undoManager.redo();
    this.reassertRemoteDeletions();
  }

  destroy() {
    if (this.destroyed) return;
    this.cancelPointer();
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.overlayAttachTimer !== null) clearTimeout(this.overlayAttachTimer);
    this.overlayAttachTimer = null;
    this.yMap.unobserve(this.onYMapChange);
    this.undoManager.doc.off('afterTransaction', this.undoManager.afterTransactionHandler);
    this.undoManager.clear();
    this.remoteDeletedKeys.clear();
    this.codePreviewCache.clear();
    this.cameraFrameListeners.clear();
    this.overlayDiv?.remove();
  }

  // ─── render loop ─────────────────────────────────────────────────────────
  private loop = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.dirty) return;
    this.dirty = false;
    this.render();
  };

  private vpBox() {
    const a = this.clientToWorld(this.cv.getBoundingClientRect().left, this.cv.getBoundingClientRect().top);
    const b = this.clientToWorld(this.cv.getBoundingClientRect().right, this.cv.getBoundingClientRect().bottom);
    return { minX:a.x-200, minY:a.y-200, maxX:b.x+200, maxY:b.y+200 };
  }

  private render() {
    const {cx, cv, cam} = this;
    cx.resetTransform();
    cx.fillStyle = '#f8f8f5';
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.translate(cv.width/2, cv.height/2);
    cx.scale(cam.zoom, cam.zoom);
    cx.translate(-cam.x, -cam.y);

    this.drawGrid();

    const vp = this.vpBox();
    const diagramDepth = (shape: DiagramShape) => {
      let depth = 0, parentId = shape.containerId;
      const visited = new Set<string>([shape.id]);
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = this.shapes.get(parentId);
        if (parent?.type !== 'diagram') break;
        depth++;
        parentId = (parent as DiagramShape).containerId;
      }
      return depth;
    };
    const paintDepth = (shape: AnyShape) => {
      if (shape.type === 'diagram') return diagramDepth(shape as DiagramShape);
      if (shape.type === 'connector') {
        const parent = shape.containerId ? this.shapes.get(shape.containerId) : undefined;
        return parent?.type === 'diagram' ? diagramDepth(parent as DiagramShape) + 0.5 : -0.5;
      }
      return 0;
    };
    // Containers paint first; their structurally-contained connectors paint over the frame but
    // under the child nodes. Uncontained connectors remain behind root-level shape silhouettes.
    const visible = this.rtree.search(vp).sort((a, b) => paintDepth(a) - paintDepth(b) || a.id.localeCompare(b.id));
    visible.forEach(s => {
      if (s.id !== this.editingId || !isDomOverlayShape(s)) {
        this.drawShape(s);
      }
    });
    if (this.connectorTargetFeedback) this.drawConnectorTargetFeedback(this.connectorTargetFeedback);

    if (this.tool === 'eraser' && this.eraserCursorPoint) {
      const radius = ERASER_RADIUS_PX / cam.zoom;
      cx.save();
      cx.beginPath(); cx.arc(this.eraserCursorPoint.x, this.eraserCursorPoint.y, radius, 0, Math.PI * 2);
      cx.fillStyle = 'rgba(255,255,255,.18)'; cx.fill();
      cx.strokeStyle = 'rgba(255,255,255,.95)'; cx.lineWidth = 3 / cam.zoom; cx.stroke();
      cx.beginPath(); cx.arc(this.eraserCursorPoint.x, this.eraserCursorPoint.y, radius, 0, Math.PI * 2);
      cx.strokeStyle = 'rgba(15,23,42,.95)'; cx.lineWidth = 1.2 / cam.zoom; cx.stroke();
      cx.restore();
    }

    // Update overlay transforms
    this.wrapperDiv.style.transform = `translate(${cv.width/2}px, ${cv.height/2}px) scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
    this.notifyCameraFrame();
    
    // Rebuild overlays only if necessary
    let overlayHtml = '';
    const domShapes = visible.filter(isDomOverlayShape);
    const codePreviewMarkup = new Map<string, string>();
    let stateSignature = '';

    domShapes.forEach(s => {
      if (s.type === 'code') {
        const language = normalizeCodeLanguage(s.language);
        const source = String(s.text ?? '');
        codePreviewMarkup.set(s.id, this.codePreviewCache.render(s.id, source, language, () => {
          if (!this.destroyed) this.dirty = true;
        }));
        const preview = this.codePreviewCache.snapshot(s.id);
        stateSignature += `syntax:${preview?.engine}:${preview?.version}|`;
      }
      const text = 'text' in s && typeof s.text === 'string' ? s.text : '';
      const previewText = s.type === 'math' ? s.previewText ?? '' : '';
      const language = s.type === 'code' ? s.language ?? '' : '';
      const source = s.type === 'image' ? s.src : s.type === 'video' ? (s as VideoShape).src : '';
      const linkCardSig = s.type === 'link-card' ? `${(s as LinkCardShape).url}:${(s as LinkCardShape).status}:${(s as LinkCardShape).title}:${(s as LinkCardShape).image}` : '';
      const stickyTime = s.type === 'sticky' ? (s as StickyShape).createdAt ?? '' : '';
      stateSignature += `${s.id}:${text}:${previewText}:${language}:${s.w}:${s.h}:${s.x}:${s.y}:${s.rotation ?? 0}:${source}:${linkCardSig}:${stickyTime}:sel${this.sel.has(s.id)}|`;
    });
    stateSignature += `editing:${this.editingId}`;

    if (this.lastOverlayState !== stateSignature) {
      this.lastOverlayState = stateSignature;
      domShapes.forEach(s => {
      if (s.id !== this.editingId) {
        let content = '';
        if (s.type === 'image') {
          overlayHtml += `<div id="ol_${s.id}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; pointer-events:auto;"><img src="${s.src}" style="width:100%; height:100%; display:block; pointer-events:none;" /></div>`;
        } else if (s.type === 'video') {
          const vid = s as VideoShape;
          const safeSrc = (vid.src || '').replace(/"/g, '&quot;');
          overlayHtml += `<div id="ol_${s.id}" class="board-video-overlay" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; pointer-events:auto; border-radius:8px; overflow:hidden; background:#0f172a; box-shadow:0 6px 20px rgba(0,0,0,0.2); display:flex; flex-direction:column;">
            <video src="${safeSrc}" controls playsinline preload="metadata" style="width:100%; height:100%; object-fit:contain; display:block; outline:none; background:#000;" onpointerdown="event.stopPropagation()"></video>
          </div>`;
        } else if (s.type === 'link-card') {
          const card = s as LinkCardShape;
          const safeUrl = (card.url || '').replace(/"/g, '&quot;');
          const safeTitle = (card.title || card.siteName || card.url || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          const safeDesc = (card.description || card.url || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          let domain = 'Website';
          try { domain = new URL(card.url, 'http://localhost').hostname.replace(/^www\./i, ''); } catch { /* ignore */ }
          const safeSite = (card.siteName || domain).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const safeFavicon = card.favicon ? card.favicon.replace(/"/g, '&quot;') : '';
          const safeImage = card.image ? card.image.replace(/"/g, '&quot;') : '';
          const isVideo = card.mediaType === 'video' || Boolean(card.embedUrl) || card.url.includes('youtube.com') || card.url.includes('youtu.be');
          const isLoading = card.status === 'loading';

          let mediaHtml = '';
          if (isLoading) {
            mediaHtml = `<div class="link-card-shimmer" style="width:100%; height:55%; background:linear-gradient(90deg, #e2e8f0 25%, #f8fafc 50%, #e2e8f0 75%); background-size:200% 100%; animation:shimmer 1.5s infinite; flex-shrink:0;"></div>`;
          } else if (safeImage) {
            const playBadge = isVideo ? `<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.25); pointer-events:none;"><div style="width:40px; height:40px; border-radius:50%; background:rgba(239,68,68,0.92); display:flex; align-items:center; justify-content:center; box-shadow:0 4px 12px rgba(0,0,0,0.3);"><svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff" style="margin-left:2px;"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>` : '';
            mediaHtml = `<div style="position:relative; width:100%; height:55%; overflow:hidden; background:#0f172a; flex-shrink:0;">
              <img src="${safeImage}" alt="" style="width:100%; height:100%; object-fit:cover; display:block; pointer-events:none;" />
              ${playBadge}
            </div>`;
          }

          const faviconHtml = safeFavicon ? `<img src="${safeFavicon}" alt="" style="width:13px; height:13px; border-radius:2px; flex-shrink:0; pointer-events:none;" onerror="this.style.display='none'" />` : '';

          overlayHtml += `<div id="ol_${s.id}" class="board-link-card-overlay" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; pointer-events:auto; border-radius:10px; overflow:hidden; background:#ffffff; border:1px solid rgba(226, 232, 240, 0.9); box-shadow:0 8px 24px -4px rgba(0,0,0,0.10), 0 4px 8px -2px rgba(0,0,0,0.05); display:flex; flex-direction:column; user-select:none; font-family:'Inter',system-ui,sans-serif;">
            ${mediaHtml}
            <div style="flex:1; padding:8px 12px 6px 12px; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; background:#ffffff;">
              <div style="overflow:hidden;">
                <div style="display:flex; align-items:center; gap:5px; font-size:10.5px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:3px;">
                  ${faviconHtml}
                  <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeSite}</span>
                </div>
                <div style="font-size:12.5px; font-weight:650; color:#0f172a; line-height:1.25; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; margin-bottom:3px;">
                  ${safeTitle}
                </div>
                <div style="font-size:11px; color:#475569; line-height:1.3; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">
                  ${safeDesc}
                </div>
              </div>
              <div style="display:flex; align-items:center; justify-content:space-between; padding-top:4px; border-top:1px solid #f1f5f9; margin-top:2px;" onpointerdown="event.stopPropagation()">
                <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; color:#2563eb; text-decoration:none;" onpointerdown="event.stopPropagation()">
                  <span>Open link</span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              </div>
            </div>
          </div>`;
        } else if (s.type === 'sticky') {
          content = s.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const timestamp = (s as StickyShape).createdAt;
          const timeHtml = timestamp ? `<div class="board-sticky-timestamp" style="font-size:10.5px; opacity:0.65; margin-bottom:4px; font-variant-numeric:tabular-nums; line-height:1.2; user-select:none; display:flex; align-items:center; gap:4px; font-weight:550; color:rgba(15,23,42,0.85);"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.75; flex-shrink:0;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>${timestamp}</span></div>` : '';
          const padding = timestamp ? '12px 16px 14px 16px' : '14px 16px 14px 16px';
          overlayHtml += `<div id="ol_${s.id}" class="board-sticky-overlay" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; border-radius:4px; background:${s.bg}; box-shadow:0 4px 16px rgba(0,0,0,0.1); pointer-events:auto; overflow:hidden;"><div class="sticky-dog-ear" style="position:absolute; top:0; right:0; width:16px; height:16px; background:rgba(0,0,0,0.10); clip-path:polygon(100% 0, 0 0, 100% 100%); z-index:5; pointer-events:none;"></div><div class="board-sticky-scroll-content" style="width:100%; height:100%; overflow-y:auto; overflow-x:hidden; padding:${padding}; box-sizing:border-box; font-size:${s.fs || 14}px; font-family:'Inter',system-ui,sans-serif; line-height:1.35; color:rgba(15,15,15,0.88); white-space:pre-wrap; word-break:break-word;">${timeHtml}${content}</div></div>`;
        } else if (s.type === 'math') {
          const source = s.text;
          const storedPreview = s.previewText;
          const isNewDraft = storedPreview === '';
          const hasValidPreview = typeof storedPreview === 'string' && storedPreview.trim().length > 0;
          const previewSource = hasValidPreview ? storedPreview : (isNewDraft ? '\\square' : (source || '\\square'));
          const stalePreview = hasValidPreview && previewSource !== source;
          try {
            const ast = parseTelex(previewSource);
            content = renderFormulaToHTML(ast, (s.fs || 14));
          } catch {
            content = '<span class="fm-render-error" role="status">Formula could not be parsed; source is preserved.</span>';
          }
          const status = stalePreview ? '<span class="fm-preview-stale" role="status" aria-label="Showing the last valid formula preview">Last valid preview</span>' : '';
          const boxWidth = Math.max(48, Number(s.w) || 0), boxHeight = Math.max(36, Number(s.h) || 0);
          overlayHtml += `<div id="ol_${s.id}" class="board-math-preview" aria-label="Rendered mathematical formula${stalePreview ? '; showing the last valid preview while the draft is invalid' : ''}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${boxWidth}px; height:${boxHeight}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; font-size:${(s.fs||14)}px; color:#000; padding:16px; box-sizing:border-box; overflow:visible; background:transparent; border-radius:4px; pointer-events:auto; display:flex; align-items:center; justify-content:center;">${content}${status}</div>`;
        } else if (s.type === 'code') {
          const language = normalizeCodeLanguage(s.language);
          const languageLabel = CODE_LANGUAGES.find(option => option.value === language)?.label ?? language;
          const preview = this.codePreviewCache.snapshot(s.id);
          const engine = preview?.engine ?? 'language-aware-fallback';
          const fallbackLabel = engine === 'codemirror' ? '' : '; using language-aware fallback highlighting';
          const rows = codePreviewMarkup.get(s.id) ?? '';
          overlayHtml += `<div id="ol_${s.id}" class="board-code-preview" role="region" tabindex="0" data-language="${language}" data-highlight-engine="${engine}" aria-label="${languageLabel} syntax-highlighted code preview; source spacing and line breaks are preserved${fallbackLabel}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; font-size:${(s.fs||14)}px; font-family:'JetBrains Mono','SFMono-Regular',Consolas,monospace; line-height:1.5; color:#d4d4d4; box-sizing:border-box; overflow:auto; background:#1b2430; border-radius:6px; border:1px solid #344253; pointer-events:auto; overscroll-behavior:contain;"><div class="board-code-lines">${rows}</div></div>`;
        } else if (s.type === 'text') {
          content = s.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          overlayHtml += `<div id="ol_${s.id}" class="board-text-overlay" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${s.rotation ?? 0}deg); transform-origin:center center; font-size:${s.fs || 14}px; font-family:'Inter',system-ui,sans-serif; line-height:1.35; color:${s.color || '#1e293b'}; padding:8px 12px; box-sizing:border-box; overflow:hidden; white-space:pre-wrap; word-break:break-word; pointer-events:auto;">${content}</div>`;
        }

        if (this.sel.has(s.id)) {
          const z = Math.max(0.04, this.cam.zoom), p = 4 / z, hs = 4 / z, border = 1.5 / z, rotation = s.rotation ?? 0;
          const handles = [[-p, -p], [s.w / 2, -p], [s.w + p, -p], [s.w + p, s.h / 2], [s.w + p, s.h + p],
            [s.w / 2, s.h + p], [-p, s.h + p], [-p, s.h / 2]];
          overlayHtml += `<div class="board-dom-selection-chrome" data-selection-for="${s.id}" style="position:absolute; left:${s.x}px; top:${s.y}px; width:${s.w}px; height:${s.h}px; transform:rotate(${rotation}deg); transform-origin:center center; pointer-events:none;">
            <div style="position:absolute; left:${-p}px; top:${-p}px; width:${s.w + p * 2}px; height:${s.h + p * 2}px; border:${border}px solid #3b82f6; border-radius:${3 / z}px; box-sizing:border-box;"></div>
            ${handles.map(([x, y]) => `<div style="position:absolute; left:${x - hs}px; top:${y - hs}px; width:${hs * 2}px; height:${hs * 2}px; background:#fff; border:${border}px solid #3b82f6; border-radius:50%; box-sizing:border-box;"></div>`).join('')}
            <div style="position:absolute; left:${s.w / 2 - border / 2}px; top:${-22 / z}px; width:${border}px; height:${18 / z}px; background:#3b82f6;"></div>
            <div style="position:absolute; left:${s.w / 2 - hs}px; top:${-26 / z - hs}px; width:${hs * 2}px; height:${hs * 2}px; background:#fff; border:${border}px solid #3b82f6; border-radius:50%;"></div>
          </div>`;
        }
      }
    });
      this.wrapperDiv.innerHTML = overlayHtml;
    }

    // selection box marquee
    if (this.isBoxing) {
      const x0=Math.min(this.boxA.x,this.boxB.x), y0=Math.min(this.boxA.y,this.boxB.y);
      const w=Math.abs(this.boxA.x-this.boxB.x), h=Math.abs(this.boxA.y-this.boxB.y);
      cx.fillStyle='rgba(59,130,246,0.1)'; cx.fillRect(x0,y0,w,h);
      cx.strokeStyle='#3b82f6'; cx.lineWidth=1/cam.zoom; cx.strokeRect(x0,y0,w,h);
    }

    if (this.isLassoing && this.lassoPts.length > 0) {
      cx.beginPath();
      cx.moveTo(this.lassoPts[0].x, this.lassoPts[0].y);
      for(let i=1; i<this.lassoPts.length; i++) cx.lineTo(this.lassoPts[i].x, this.lassoPts[i].y);
      cx.fillStyle='rgba(59,130,246,0.1)'; cx.fill();
      cx.strokeStyle='#3b82f6'; cx.lineWidth=1.5/cam.zoom; cx.setLineDash([5/cam.zoom, 5/cam.zoom]);
      cx.stroke();
      cx.setLineDash([]); // reset
    }

    // selection outlines + resize handles
    this.sel.forEach(id => {
      const s = this.shapes.get(id);
      if (s) this.drawSelection(s);
    });
  }

  private drawGrid() {
    const { cx, cam } = this;
    const vp = this.vpBox();
    let step = 40;
    for (let count = 0; count < 12 && step * cam.zoom < 28; count++) step *= 2;
    for (let count = 0; count < 12 && step * cam.zoom > 76; count++) step /= 2;

    const startX = Math.floor(vp.minX / step);
    const startY = Math.floor(vp.minY / step);
    const endX = Math.ceil(vp.maxX / step);
    const endY = Math.ceil(vp.maxY / step);
    const majorEvery = 4;
    cx.save();

    cx.beginPath();
    for (let index = startX; index <= endX; index++) {
      if (index % majorEvery === 0) continue;
      const x = index * step;
      cx.moveTo(x, vp.minY);
      cx.lineTo(x, vp.maxY);
    }
    for (let index = startY; index <= endY; index++) {
      if (index % majorEvery === 0) continue;
      const y = index * step;
      cx.moveTo(vp.minX, y);
      cx.lineTo(vp.maxX, y);
    }
    cx.strokeStyle = 'rgba(78, 91, 108, 0.075)';
    cx.lineWidth = 0.65 / cam.zoom;
    cx.stroke();

    cx.beginPath();
    for (let index = startX; index <= endX; index++) {
      if (index % majorEvery !== 0) continue;
      const x = index * step;
      cx.moveTo(x, vp.minY);
      cx.lineTo(x, vp.maxY);
    }
    for (let index = startY; index <= endY; index++) {
      if (index % majorEvery !== 0) continue;
      const y = index * step;
      cx.moveTo(vp.minX, y);
      cx.lineTo(vp.maxX, y);
    }
    cx.strokeStyle = 'rgba(78, 91, 108, 0.12)';
    cx.lineWidth = 0.85 / cam.zoom;
    cx.stroke();
    cx.restore();
  }

  private cachedDiagramGeometry(shape: DiagramShape): CachedDiagramGeometry {
    const params = shape.params ?? {};
    const definition = getShapeDefinition(shape.shapeId)!;
    const tableColumns = (shape.data?.table as { columns?: unknown[] } | undefined)?.columns;
    const effectiveParams = definition.geometry === 'table' && Array.isArray(tableColumns) && tableColumns.length > 0
      ? { ...params, rowCount: tableColumns.length + 1 }
      : params;
    const scale = definition.solid3d
      ? shape.scale3d ?? definition.defaultScale3d ?? solid3DScaleFromBounds(shape.w, shape.h, definition.width, definition.height, definition.geometry as Solid3DGeometry) : undefined;
    const key = `${shape.shapeId}|${shape.w}|${shape.h}|${JSON.stringify(effectiveParams)}|${JSON.stringify(scale ?? null)}`;
    const cached = this.geometryCache.get(shape as object);
    if (cached?.key === key) return cached;
    const geometry = buildShapeGeometry(definition, shape.w, shape.h, effectiveParams, definition.solid3d ? {
      scale, referenceWidth: definition.width, referenceHeight: definition.height, center: { x: 0, y: 0 },
    } : undefined);
    const { outline, decorations, decorationStyles, intrinsicFills, intrinsicFillColors, hiddenEdges, visibleFaces = [], projection } = geometry;
    const makePath = (commands: PathCommand[]) => {
      if (typeof Path2D === 'undefined') return undefined;
      const path = new Path2D();
      const supportsCommands = commands.every(({ op }) => {
        if (op === 'moveTo') return typeof path.moveTo === 'function';
        if (op === 'lineTo') return typeof path.lineTo === 'function';
        if (op === 'quadraticCurveTo') return typeof path.quadraticCurveTo === 'function';
        if (op === 'bezierCurveTo') return typeof path.bezierCurveTo === 'function';
        if (op === 'ellipse') return typeof path.ellipse === 'function';
        return typeof path.closePath === 'function';
      });
      return supportsCommands ? drawPathCommands(this.cx, commands, path) : undefined;
    };
    const entry: CachedDiagramGeometry = { key, outline, decorations, decorationStyles, intrinsicFills, intrinsicFillColors, hiddenEdges, visibleFaces, projection, path: makePath(outline),
      decorationPaths: decorations.map(makePath), intrinsicFillPaths: intrinsicFills.map(makePath), hiddenEdgePaths: hiddenEdges.map(makePath),
      visibleFacePaths: visibleFaces.map(face => makePath(face.commands)) };
    this.geometryCache.set(shape as object, entry);
    return entry;
  }

  private drawDiagramShape(shape: DiagramShape) {
    const definition = getShapeDefinition(shape.shapeId);
    if (!definition) return;
    const cx = this.cx, geometry = definition.geometry, params = shape.params ?? {};
    const cached = this.cachedDiagramGeometry(shape);
    const is3D = Boolean(definition.solid3d);
    const hasFill = geometryUsesFill(geometry) && fillIsVisible(shape.fill);
    const zoom = Math.max(0.04, this.cam.zoom);
    cx.save();
    cx.translate(shape.x, shape.y);
    cx.fillStyle = shape.fill; cx.strokeStyle = shape.stroke;
    cx.lineWidth = is3D ? Math.max(1.5, Math.min(2, shape.sw || 1.8)) / zoom : Math.max(0, shape.sw);
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    const lineStyle = params.lineStyle;
    cx.setLineDash(lineStyle === 'dashed' ? [7, 4] : lineStyle === 'dotted' ? [2, 3] : []);
    if (params.callActivity === true) cx.lineWidth = Math.max(cx.lineWidth, shape.sw * 1.8);
    if (params.eventKind === 'end') cx.lineWidth = Math.max(cx.lineWidth, shape.sw * 2.2);
    const drawHiddenEdges = () => {
      if (!cached.hiddenEdges.length || (!is3D && shape.sw <= 0)) return;
      cx.save();
      if (is3D) { cx.lineWidth = 1.6 / zoom; cx.setLineDash([8 / zoom, 5 / zoom]); }
      else cx.setLineDash([4, 3]);
      for (let index = 0; index < cached.hiddenEdges.length; index++) {
        const path = cached.hiddenEdgePaths?.[index];
        if (path) cx.stroke(path);
        else { drawPathCommands(cx, cached.hiddenEdges[index]); cx.stroke(); }
      }
      cx.restore();
    };
    // Hidden 3D topology is the rear stroke pass: transparent faces reveal its dashes, while a
    // later opaque surface fill correctly occludes it. Visible semantic edges are stroked last.
    if (is3D) drawHiddenEdges();
    // Polyhedra fill depth-sorted faces; smooth curved solids fill continuous projected surface and draw only semantic edge curves.
    if (is3D && hasFill) {
      cx.fillStyle = shape.fill;
      const curvedSolid = ['sphere3d', 'cylinder3d', 'cone3d', 'coneFrustum3d'].includes(String(geometry));
      if (curvedSolid) {
        // A curved solid is a continuous surface. Fill its real projected silhouette once, then
        // render only its semantic rims/generators/equator; tessellation polygons are not strokes.
        if (cached.path) cx.fill(cached.path);
        else { drawPathCommands(cx, cached.outline); cx.fill(); }
      } else {
        for (let index = 0; index < cached.visibleFaces.length; index++) {
          const path = cached.visibleFacePaths?.[index];
          if (path) cx.fill(path);
          else { drawPathCommands(cx, cached.visibleFaces[index].commands); cx.fill(); }
        }
      }
    } else if (!is3D && hasFill) {
      if (cached.path) cx.fill(cached.path);
      else { drawPathCommands(cx, cached.outline); cx.fill(); }
    }
    if (cached.intrinsicFills.length) {
      cached.intrinsicFills.forEach((commands, index) => {
        cx.fillStyle = cached.intrinsicFillColors[index] === 'surface' ? '#f1f5f9' : shape.stroke;
        const path = cached.intrinsicFillPaths?.[index];
        if (path) cx.fill(path);
        else { drawPathCommands(cx, commands); cx.fill(); }
      });
      cx.fillStyle = shape.fill;
    }
    if (!is3D) drawHiddenEdges();
    cx.setLineDash(lineStyle === 'dashed' ? [7, 4] : lineStyle === 'dotted' ? [2, 3] : []);
    // 3D `outline` is a projected fill/hit boundary, not a second stroke pass. Its actual
    // silhouette edges are already included once in the visible semantic edge/curve paths.
    if (shape.sw > 0 && !definition.solid3d) {
      if (cached.path) cx.stroke(cached.path);
      else { drawPathCommands(cx, cached.outline); cx.stroke(); }
    }
    for (let index = 0; index < cached.decorations.length; index++) {
      const decorationStyle = cached.decorationStyles[index] ?? lineStyle;
      cx.setLineDash(decorationStyle === 'dashed' ? [7, 4] : decorationStyle === 'dotted' ? [2, 3] : []);
      const path = cached.decorationPaths?.[index];
      if (path) cx.stroke(path);
      else { drawPathCommands(cx, cached.decorations[index]); cx.stroke(); }
    }
    if (shape.shapeId === 'uml.frame') {
      const fragment = shape.data?.sequenceFragment as SequenceFragmentData | undefined;
      const operands = fragment?.operands ?? [];
      if (operands.length > 1) {
        const contentTop = Math.min(shape.h, shape.h * 0.14);
        const operandHeight = Math.max(1, (shape.h - contentTop) / operands.length);
        cx.save(); cx.strokeStyle = shape.stroke; cx.lineWidth = Math.max(1, shape.sw) / zoom; cx.setLineDash([6 / zoom, 4 / zoom]);
        for (let index = 1; index < operands.length; index++) {
          const y = contentTop + operandHeight * index;
          cx.beginPath(); cx.moveTo(0, y); cx.lineTo(shape.w, y); cx.stroke();
        }
        cx.restore();
      }
      if (fragment) {
        const contentTop = Math.min(shape.h, shape.h * 0.14);
        const operandHeight = Math.max(1, (shape.h - contentTop) / Math.max(1, operands.length));
        cx.save(); cx.fillStyle = shape.textColor ?? '#1f2937'; cx.textAlign = 'left'; cx.textBaseline = 'top';
        cx.font = `${12 / zoom}px Inter, 'Segoe UI', sans-serif`;
        operands.forEach((operand, index) => {
          const guard = operand.guard.trim();
          if (guard) cx.fillText(`[${guard}]`, Math.max(8 / zoom, 8), contentTop + index * operandHeight + 5 / zoom,
            Math.max(1, shape.w - 16 / zoom));
        });
        cx.restore();
      }
    }
    if (shape.shapeId === 'uml.use-case' || shape.shapeId === 'uml.use-case-ext') {
      const usecase = shape.data?.usecase as UMLUseCaseData | undefined;
      const extensionPoints = usecase?.extensionPoints ?? [];
      const textCapabilities = diagramCapabilitiesFor(definition).text;
      const defW = definition.width ?? 160, defH = definition.height ?? 85;
      const dimensionRatio = Math.sqrt((shape.w / defW) * (shape.h / defH));
      const fontScale = Number.isFinite(shape.embeddedTextScale) && (shape.embeddedTextScale ?? 0) > 0
        ? Math.max(0.25, Math.min(16, shape.embeddedTextScale!))
        : Math.max(0.3, Math.min(16, dimensionRatio));
      const scaledFs = Math.max(textCapabilities.minFontSize ?? 12, (shape.fs ?? 14) * fontScale);
      const roleTypography = diagramTypography(textCapabilities.role ?? 'use-case', scaledFs, textCapabilities.minFontSize ?? 12);
      const secondaryFs = roleTypography?.secondary ?? scaledFs * 0.75;
      if (extensionPoints.length > 0) {
        const epLineHeight = Math.max(14 * fontScale, secondaryFs * 1.35);
        const epHeight = (extensionPoints.length + 1) * epLineHeight + 10 * fontScale;
        const dividerY = Math.max(shape.h * 0.35, Math.min(shape.h * 0.70, shape.h - epHeight));
        const dy = Math.abs(dividerY - shape.h / 2);
        if (dy < shape.h / 2) {
          const dx = (shape.w / 2) * Math.sqrt(Math.max(0, 1 - (dy / (shape.h / 2)) ** 2));
          cx.save(); cx.strokeStyle = shape.stroke; cx.lineWidth = Math.max(1, shape.sw * 0.85);
          cx.beginPath(); cx.moveTo(shape.w / 2 - dx, dividerY); cx.lineTo(shape.w / 2 + dx, dividerY); cx.stroke();
          cx.restore();
        }
      }
      const isBusiness = shape.params?.businessUseCase === true
        || (typeof shape.params?.stereotype === 'string' && shape.params.stereotype.toLowerCase().includes('business'))
        || usecase?.isBusinessUseCase === true;
      if (isBusiness) {
        cx.save(); cx.strokeStyle = shape.stroke; cx.lineWidth = Math.max(1.2, shape.sw);
        cx.beginPath();
        cx.moveTo(shape.w * 0.14, shape.h * 0.28);
        cx.lineTo(shape.w * 0.26, shape.h * 0.72);
        cx.moveTo(shape.w * 0.19, shape.h * 0.24);
        cx.lineTo(shape.w * 0.31, shape.h * 0.76);
        cx.stroke();
        cx.restore();
      }
    }
    if (definition.geometry === 'actor') {
      const glyphH = shape.h * 0.68;
      const radius = Math.min(shape.w * 0.18, glyphH * 0.14);
      const headCenterY = radius + 3;
      cx.save();
      cx.fillStyle = shape.fill === 'transparent' ? '#ffffff' : shape.fill;
      cx.beginPath();
      cx.arc(shape.w / 2, headCenterY, radius, 0, Math.PI * 2);
      cx.fill();
      cx.restore();
    }
    cx.setLineDash([]);
    if (definition.solid3d && cached.projection?.projectedBounds) {
      const bounds = cached.projection.projectedBounds;
      const labelShape = { ...shape, w: Math.max(1, bounds.maxX - bounds.minX), h: Math.max(1, bounds.maxY - bounds.minY) };
      cx.save(); cx.translate(bounds.minX, bounds.minY);
      this.drawDiagramLabel(labelShape, definition);
      cx.restore();
    } else this.drawDiagramLabel(shape, definition);
    cx.restore();
  }

  private drawDiagramLabel(shape: DiagramShape, definition: ShapeDefinition) {
    const params = shape.params ?? {};
    const text = typeof shape.text === 'string' ? shape.text.trim() : (typeof params.title === 'string' ? params.title : '');
    const cx = this.cx, w = shape.w, h = shape.h;
    const canonicalUml = definition.semantic?.notation === 'uml';
    const textCapabilities = diagramCapabilitiesFor(definition).text;
    const defW = definition.width ?? 160, defH = definition.height ?? 85;
    const dimensionRatio = Math.sqrt((w / defW) * (h / defH));
    const fontScale = Number.isFinite(shape.embeddedTextScale) && (shape.embeddedTextScale ?? 0) > 0
      ? Math.max(0.25, Math.min(16, shape.embeddedTextScale!))
      : Math.max(0.3, Math.min(16, dimensionRatio));
    const minFontSize = textCapabilities.minFontSize ?? 12;
    const scaledFs = Math.max(minFontSize, (shape.fs ?? 14) * fontScale);
    const roleTypography = canonicalUml ? diagramTypography(textCapabilities.role ?? 'state', scaledFs, minFontSize) : null;
    const minFont = (size: number) => Math.max(minFontSize, size * fontScale);
    const fs = roleTypography?.body ?? scaledFs;
    const titleFs = roleTypography?.title ?? fs * 1.15;
    const secondaryFs = roleTypography?.secondary ?? fs * 0.75;
    cx.save();
    cx.beginPath(); cx.rect(0, 0, w, h); cx.clip();
    cx.fillStyle = shape.textColor ?? '#1f2937';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.font = `${params.italicName === true ? 'italic ' : ''}${fs}px Inter, 'Segoe UI', sans-serif`;

    const isStructuredShape = definition.geometry === 'table' && (
      (Boolean(shape.data?.table) && Array.isArray(shape.data?.table?.columns)) ||
      (Boolean(shape.data?.classifier) && Array.isArray((shape.data?.classifier as unknown as Record<string, unknown>)?.compartments)) ||
      (Boolean(shape.data?.instance) && Array.isArray((shape.data?.instance as unknown as Record<string, unknown>)?.values))
    );
    if (shape.id === this.editingId && !isStructuredShape && shape.shapeId !== 'uml.use-case-ext') {
      cx.restore(); return;
    }

    if (definition.geometry === 'table' && definition.dataCapabilities?.includes('table')
      && shape.data?.table && isRecord(shape.data.table) && Array.isArray(shape.data.table.columns)) {
      this.drawStructuredErTableLabel(shape, definition, shape.data.table.columns as unknown[]);
      cx.restore(); return;
    }
    if (definition.geometry === 'table' && definition.dataCapabilities?.includes('classifier')
      && shape.data?.classifier && isRecord(shape.data.classifier) && Array.isArray(shape.data.classifier.compartments)) {
      this.drawStructuredClassifierLabel(shape, definition, shape.data.classifier as Record<string, unknown>);
      cx.restore(); return;
    }
    if (definition.geometry === 'table' && definition.dataCapabilities?.includes('instance')
      && shape.data?.instance && isRecord(shape.data.instance) && Array.isArray(shape.data.instance.values)) {
      this.drawStructuredInstanceLabel(shape, definition, shape.data.instance as Record<string, unknown>);
      cx.restore(); return;
    }
    if (definition.geometry === 'column' && shape.data?.column && isRecord(shape.data.column)) {
      const column = shape.data.column;
      const key = column.key === 'primary' ? 'PK' : column.key === 'foreign' ? 'FK' : '';
      const name = typeof column.name === 'string' && column.name.trim() ? column.name.trim() : 'column';
      const type = typeof column.type === 'string' && column.type.trim() ? ` : ${column.type.trim()}` : '';
      const pad = Math.max(minFont(2), Math.min(8 * fontScale, w * 0.05));
      cx.font = `${Math.max(minFont(4), Math.min(fs, h * 0.42))}px Inter, 'Segoe UI', sans-serif`;
      if (key) { cx.textAlign = 'center'; cx.fillText(key, w * 0.16, h / 2, w * 0.25); }
      cx.textAlign = 'left'; cx.fillText(`${name}${type}`, w * 0.36 + pad * 0.25, h / 2, Math.max(1, w * 0.64 - pad));
      cx.restore(); return;
    }
    if (definition.geometry === 'umlLifeline') {
      const headerHeight = Math.min(h, SEQUENCE_LIFELINE_HEADER_HEIGHT);
      cx.font = `600 ${Math.max(minFont(4), Math.min(titleFs, headerHeight * 0.42))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, headerHeight / 2, Math.max(1, w - minFont(10)));
      cx.restore(); return;
    }
    if (definition.geometry === 'umlActorParticipant') {
      const headerHeight = Math.min(h, SEQUENCE_ACTOR_HEADER_HEIGHT);
      const labelY = Math.min(headerHeight - 2, SEQUENCE_ACTOR_GLYPH_HEIGHT
        + Math.max(4, (headerHeight - SEQUENCE_ACTOR_GLYPH_HEIGHT) * 0.52));
      cx.font = `600 ${Math.max(minFont(4), Math.min(titleFs, Math.max(4, headerHeight - SEQUENCE_ACTOR_GLYPH_HEIGHT) * 0.72))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, labelY, Math.max(1, w - minFont(8)));
      cx.restore(); return;
    }
    if (definition.geometry === 'useCase') {
      const usecase = shape.data?.usecase as UMLUseCaseData | undefined;
      const extensionPoints = usecase?.extensionPoints ?? [];
      const stereotype = typeof params.stereotype === 'string' ? params.stereotype.trim() : (usecase?.stereotype?.trim() ?? '');
      if (extensionPoints.length > 0) {
        const epLineHeight = Math.max(14 * fontScale, secondaryFs * 1.35);
        const epHeight = (extensionPoints.length + 1) * epLineHeight + 10 * fontScale;
        const dividerY = Math.max(h * 0.35, Math.min(h * 0.70, h - epHeight));
        const upperCenterY = dividerY / 2;
        const upperDy = Math.abs(upperCenterY - h / 2);
        const upperChordW = w * Math.sqrt(Math.max(0, 1 - (upperDy / (h / 2)) ** 2));
        const upperMaxW = Math.max(fs * 2, upperChordW * 0.78);

        if (stereotype) {
          cx.font = `600 ${Math.max(9, secondaryFs * 0.95)}px Inter, 'Segoe UI', sans-serif`;
          cx.fillStyle = '#64748b';
          cx.textAlign = 'center'; cx.textBaseline = 'middle';
          cx.fillText(stereotype, w / 2, Math.max(secondaryFs, upperCenterY - fs * 0.65), upperMaxW);
        }
        cx.font = `${params.italicName === true ? 'italic ' : ''}600 ${fs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#0f172a';
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        const lines = this.wrapCanvasText(text, upperMaxW);
        const lineHeight = fs * 1.25;
        const startY = (stereotype ? upperCenterY + secondaryFs * 0.5 : upperCenterY) - (lines.length - 1) * lineHeight / 2;
        lines.forEach((line, index) => { if (line) cx.fillText(line, w / 2, startY + index * lineHeight, upperMaxW); });

        cx.font = `italic 600 ${Math.max(9, secondaryFs * 0.92)}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = '#64748b';
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText('«extension points»', w / 2, dividerY + epLineHeight * 0.55);

        const lowerMidY = dividerY + epHeight / 2;
        const lowerDy = Math.abs(lowerMidY - h / 2);
        const lowerChordW = w * Math.sqrt(Math.max(0, 1 - (lowerDy / (h / 2)) ** 2));
        const epLeft = Math.max(16 * fontScale, w / 2 - lowerChordW * 0.42);
        const epMaxW = Math.max(20, lowerChordW * 0.84);

        cx.textAlign = 'left'; cx.textBaseline = 'middle';
        cx.font = `500 ${Math.max(9.5, secondaryFs * 0.95)}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#1e293b';
        extensionPoints.forEach((ep, index) => {
          const itemY = dividerY + (index + 1.5) * epLineHeight;
          if (itemY < h - 4) {
            const itemText = ep.explanation?.trim() ? `• ${ep.name} : ${ep.explanation.trim()}` : `• ${ep.name}`;
            cx.fillText(itemText, epLeft, itemY, epMaxW);
          }
        });
        cx.restore(); return;
      }
      if (stereotype) {
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.font = `600 ${Math.max(9.5, secondaryFs)}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = '#64748b';
        cx.fillText(stereotype, w / 2, h * 0.32, Math.max(fs * 2, w * 0.72));
        cx.font = `${params.italicName === true ? 'italic ' : ''}600 ${fs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#0f172a';
        const lines = this.wrapCanvasText(text, Math.max(fs * 2, w * 0.72));
        const lineHeight = fs * 1.25;
        const firstY = h * 0.58 - (lines.length - 1) * lineHeight / 2;
        lines.forEach((line, index) => { if (line) cx.fillText(line, w / 2, firstY + index * lineHeight, Math.max(fs * 2, w * 0.72)); });
        cx.restore(); return;
      }
      cx.font = `${params.italicName === true ? 'italic ' : ''}600 ${fs}px Inter, 'Segoe UI', sans-serif`;
      cx.fillStyle = shape.textColor ?? '#0f172a';
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      const lines = this.wrapCanvasText(text, Math.max(fs * 2, w * 0.75));
      const lineHeight = fs * 1.25;
      const firstY = h / 2 - (lines.length - 1) * lineHeight / 2;
      lines.forEach((line, index) => { if (line) cx.fillText(line, w / 2, firstY + index * lineHeight); });
      cx.restore(); return;
    }
    if (definition.geometry === 'actor') {
      const stereotype = typeof params.stereotype === 'string' ? params.stereotype.trim() : '';
      const glyphH = h * 0.68;
      const labelBandTop = glyphH + 4;
      const labelBandBottom = h - 2;
      const maxWidth = Math.max(1, w * 0.95);
      cx.textAlign = 'center'; cx.textBaseline = 'middle';

      if (stereotype) {
        const stereoFs = Math.max(9, secondaryFs * 0.85);
        const nameFs = Math.max(11, fs);
        cx.font = `500 ${stereoFs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = '#64748b';
        cx.fillText(stereotype, w / 2, labelBandTop + stereoFs * 0.65, maxWidth);

        cx.font = `${params.italicName === true ? 'italic ' : ''}600 ${nameFs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#0f172a';
        const lines = this.wrapCanvasText(text, maxWidth);
        const lineHeight = nameFs * 1.2;
        const startY = labelBandTop + stereoFs * 1.4 + nameFs * 0.6;
        lines.slice(0, 2).forEach((val, idx) => {
          if (val) cx.fillText(val, w / 2, startY + idx * lineHeight, maxWidth);
        });
      } else {
        const nameFs = Math.max(11, fs);
        cx.font = `${params.italicName === true ? 'italic ' : ''}600 ${nameFs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#0f172a';
        const lines = this.wrapCanvasText(text, maxWidth);
        const lineHeight = nameFs * 1.25;
        const centerY = (labelBandTop + labelBandBottom) / 2;
        const startY = centerY - (lines.length - 1) * lineHeight / 2;
        lines.slice(0, 2).forEach((val, idx) => {
          if (val) cx.fillText(val, w / 2, startY + idx * lineHeight, maxWidth);
        });
      }
      cx.restore(); return;
    }
    if (definition.geometry === 'rightTriangle') {
      const bandTop = h * 0.60, bandBottom = h * 0.98;
      const fontSize = Math.max(minFont(3), Math.min(fs, h * 0.13, w * 0.11));
      const lineHeight = Math.min(fontSize * 1.18, Math.max(minFont(3), (bandBottom - bandTop) / 2));
      const maxWidth = Math.max(1, w * 0.44);
      cx.font = `${fontSize}px Inter, 'Segoe UI', sans-serif`;
      const lines: string[] = []; let line = '';
      for (const word of text.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && cx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
        else line = next;
      }
      if (line) lines.push(line);
      const visible = lines.slice(0, Math.max(1, Math.floor((bandBottom - bandTop) / lineHeight)));
      const firstY = (bandTop + bandBottom - visible.length * lineHeight) / 2 + lineHeight / 2;
      visible.forEach((value, index) => cx.fillText(value, w * 0.25, firstY + index * lineHeight, maxWidth));
      cx.restore(); return;
    }
    if (definition.geometry === 'internalStorage') {
      const maxWidth = Math.max(1, w * 0.57), fontSize = Math.max(minFont(3), Math.min(fs, h * 0.17));
      cx.font = `${fontSize}px Inter, 'Segoe UI', sans-serif`;
      const words = text.split(/\s+/).filter(Boolean), lines: string[] = []; let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (line && cx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
        else line = next;
      }
      if (line) lines.push(line);
      const lineHeight = Math.min(fontSize * 1.18, h * 0.24), visible = lines.slice(0, 2);
      const firstY = h * 0.62 - visible.length * lineHeight / 2 + lineHeight / 2;
      visible.forEach((value, index) => cx.fillText(value, w * 0.64, firstY + index * lineHeight, maxWidth));
      cx.restore(); return;
    }
    if (definition.geometry === 'sort') {
      cx.font = `${Math.max(minFont(3), Math.min(fs, h * 0.16))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, h * 0.30, Math.max(1, w * 0.30));
      cx.restore(); return;
    }
    if (definition.geometry === 'magneticDisk') {
      cx.font = `${Math.max(minFont(3), Math.min(fs, h * 0.14))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, h * 0.75, Math.max(1, w * 0.72));
      cx.restore(); return;
    }
    if (definition.geometry === 'diamond') {
      const isIdentifying = params.doubleBorder === true;
      const safeFraction = isIdentifying ? 0.54 : 0.64;
      const maxTextW = Math.max(minFont(8), w * safeFraction);
      const diamondFs = Math.max(minFont(4), Math.min(fs, h * 0.22, w * 0.15));
      cx.font = `${params.italicName === true ? 'italic ' : ''}600 ${diamondFs}px Inter, 'Segoe UI', sans-serif`;
      cx.fillStyle = shape.textColor ?? '#0f172a';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      const lines = this.wrapCanvasText(text, maxTextW);
      const lineHeight = diamondFs * 1.25;
      const firstY = h / 2 - (lines.length - 1) * lineHeight / 2;
      lines.forEach((line, index) => {
        if (line) cx.fillText(line, w / 2, firstY + index * lineHeight, maxTextW);
      });
      cx.restore(); return;
    }
    if (definition.geometry === 'associativeEntity') {
      cx.font = `${Math.max(minFont(3), Math.min(fs, Math.min(w, h) * 0.16))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, h / 2, Math.max(1, Math.min(w, h) * 0.66));
      cx.restore(); return;
    }
    if (definition.geometry === 'dataObject' && params.messageEnvelope === true) {
      cx.font = `${Math.max(minFont(3), Math.min(fs, h * 0.24))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, h * 0.82, Math.max(1, w * 0.84));
      cx.restore(); return;
    }
    if (definition.geometry === 'umlRole') {
      const stereotype = typeof params.stereotype === 'string' ? params.stereotype.trim() : '';
      const headerHeight = Math.min(h, SEQUENCE_ROLE_HEADER_HEIGHT);
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      if (stereotype) {
        cx.font = `600 ${Math.max(minFont(4), Math.min(secondaryFs, headerHeight * 0.16))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = '#64748b';
        cx.fillText(stereotype, w / 2, headerHeight * 0.65, Math.max(1, w - minFont(8)));
        cx.font = `600 ${Math.max(minFont(5), Math.min(titleFs, headerHeight * 0.20))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#0f172a';
        cx.fillText(text, w / 2, headerHeight * 0.88, Math.max(1, w - minFont(8)));
      } else {
        const nameFs = Math.max(11, Math.min(14, fs));
        cx.font = `600 ${nameFs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#0f172a';
        const labelCenterY = Math.round(headerHeight * 0.75);
        cx.fillText(text, w / 2, labelCenterY, Math.max(1, w - minFont(8)));
      }
      cx.restore(); return;
    }
    if (definition.geometry === 'umlState' && shape.shapeId === 'uml.state') {
      const behavior = shape.data?.stateBehavior as { entry?: string; doActivity?: string; exit?: string } | undefined;
      const rows = [
        typeof behavior?.entry === 'string' && behavior.entry.trim() ? `entry / ${behavior.entry.trim()}` : '',
        typeof behavior?.doActivity === 'string' && behavior.doActivity.trim() ? `do / ${behavior.doActivity.trim()}` : '',
        typeof behavior?.exit === 'string' && behavior.exit.trim() ? `exit / ${behavior.exit.trim()}` : '',
      ].filter(Boolean);
      if (!rows.length) {
        cx.font = `${fs}px Inter, 'Segoe UI', sans-serif`;
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(text, w / 2, h / 2, Math.max(1, w - minFont(12)));
      } else {
        const divider = h * 0.40;
        cx.font = `600 ${Math.max(minFont(4), Math.min(titleFs, divider * 0.45))}px Inter, 'Segoe UI', sans-serif`;
        cx.textAlign = 'center'; cx.fillText(text, w / 2, divider * 0.20, Math.max(1, w - minFont(12)));
        const bodyFont = Math.max(minFont(4), Math.min(secondaryFs, (h - divider - 8) / (rows.length * 1.15)));
        cx.font = `${bodyFont}px Inter, 'Segoe UI', sans-serif`; cx.textAlign = 'left'; cx.textBaseline = 'top';
        const lineHeight = bodyFont * 1.14, maxLines = Math.max(1, Math.floor((h - divider - 8) / lineHeight));
        let drawn = 0;
        for (const row of rows) {
          const lines = this.wrapCanvasText(row, Math.max(1, w - 20));
          for (const line of lines) {
            if (drawn >= maxLines) break;
            cx.fillText(line, 10, divider + 5 + drawn * lineHeight, Math.max(1, w - 20)); drawn++;
          }
        }
      }
      cx.restore(); return;
    }
    if (definition.geometry === 'activityPartition') {
      const horizontal = params.activityOrientation === 'horizontal';
      if (horizontal) {
        cx.save(); cx.translate(w * 0.12, h / 2); cx.rotate(-Math.PI / 2);
        cx.font = `600 ${Math.max(minFont(4), Math.min(titleFs, w * 0.14))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(text, 0, 0, Math.max(1, h - minFont(12)));
        cx.restore();
      } else {
        const titleHeight = h * 0.24;
        cx.font = `600 ${Math.max(minFont(4), Math.min(titleFs, titleHeight * 0.56))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(text, w / 2, titleHeight / 2, Math.max(1, w - minFont(12)));
      }
      cx.restore(); return;
    }
    if (definition.geometry === 'umlCompositeState') {
      const behavior = shape.data?.stateBehavior as { entry?: string; doActivity?: string; exit?: string } | undefined;
      const rows = [
        typeof behavior?.entry === 'string' && behavior.entry.trim() ? `entry / ${behavior.entry.trim()}` : '',
        typeof behavior?.doActivity === 'string' && behavior.doActivity.trim() ? `do / ${behavior.doActivity.trim()}` : '',
        typeof behavior?.exit === 'string' && behavior.exit.trim() ? `exit / ${behavior.exit.trim()}` : '',
      ].filter(Boolean);
      const header = h * (typeof params.stateHeaderFraction === 'number' ? params.stateHeaderFraction : 0.29);
      cx.font = `600 ${Math.max(minFont(4), Math.min(titleFs, header * (rows.length ? 0.30 : 0.56)))}px Inter, 'Segoe UI', sans-serif`;
      cx.textAlign = 'center'; cx.fillText(text, w / 2, rows.length ? header * 0.18 : header / 2, Math.max(1, w - minFont(12)));
      if (rows.length) {
        const bodyFont = Math.max(minFont(4), Math.min(secondaryFs, header * 0.20));
        cx.font = `${bodyFont}px Inter, 'Segoe UI', sans-serif`; cx.textAlign = 'left'; cx.textBaseline = 'top';
        rows.forEach((row, index) => cx.fillText(row, w * 0.12, header * 0.40 + index * bodyFont * 1.18, Math.max(1, w * 0.76)));
      }
      cx.restore(); return;
    }
    if (definition.geometry === 'ellipse' && params.key === 'foreign') {
      cx.textAlign = 'left';
      cx.font = `750 ${Math.max(minFont(4), Math.min(fs * 0.62, h * 0.15))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText('FK', w * 0.22, h * 0.24, Math.max(1, w * 0.22));
      cx.textAlign = 'center';
      cx.font = `${Math.max(minFont(5), Math.min(fs, h * 0.24))}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(text, w / 2, h * 0.55, Math.max(1, w * 0.78));
      cx.restore(); return;
    }
    if (definition.geometry === 'package') {
      // UML package/module names belong in the folder tab. Centering them in the body
      // lets an owned classifier/package child erase the container's own label.
      const tabCenterX = w * 0.23, tabTextWidth = Math.max(1, w * 0.44);
      const stereotype = typeof params.stereotype === 'string' ? params.stereotype : '';
      if (stereotype) {
        cx.font = `600 ${Math.max(minFont(2.5), Math.min(secondaryFs, h * 0.085))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(stereotype, tabCenterX, h * 0.055, tabTextWidth);
        cx.font = `600 ${Math.max(minFont(3), Math.min(titleFs * 0.90, h * 0.105))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(text, tabCenterX, h * 0.155, tabTextWidth);
      } else {
        cx.font = `600 ${Math.max(minFont(3), Math.min(titleFs, h * 0.18))}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(text, tabCenterX, h * 0.11, tabTextWidth);
      }
      cx.restore(); return;
    }
    if (definition.geometry === 'umlBoundary') {
      const titleHeight = Math.min(h, UML_BOUNDARY_TITLE_HEIGHT);
      const stereotype = typeof params.stereotype === 'string' ? params.stereotype.trim()
        : (shape.data?.subjectBoundary as { stereotype?: string } | undefined)?.stereotype?.trim() || '';
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      if (stereotype) {
        const stereoFs = Math.max(9, Math.min(titleHeight * 0.32, secondaryFs));
        const nameFs = Math.max(11, Math.min(titleHeight * 0.42, fs));
        cx.font = `600 ${stereoFs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = '#64748b';
        cx.fillText(stereotype.toUpperCase(), w / 2, titleHeight * 0.30, Math.max(1, w - 24));
        cx.font = `600 ${nameFs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#0f172a';
        cx.fillText(text, w / 2, titleHeight * 0.70, Math.max(1, w - 24));
      } else {
        const nameFs = Math.max(11, Math.min(15, shape.fs ?? 14));
        cx.font = `600 ${nameFs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#0f172a';
        cx.fillText(text, w / 2, titleHeight / 2, Math.max(1, w - 24));
      }
      cx.restore(); return;
    }
    if (definition.geometry === 'frame' && params.componentGlyph !== true) {
      const fragment = shape.shapeId === 'uml.frame' ? shape.data?.sequenceFragment as SequenceFragmentData | undefined : undefined;
      const frameFont = Math.max(minFont(4), Math.min(titleFs, h * 0.22));
      cx.textAlign = 'left'; cx.textBaseline = 'middle'; cx.font = `600 ${frameFont}px Inter, 'Segoe UI', sans-serif`;
      if (fragment) {
        cx.fillText(fragment.operator, Math.min(8 * fontScale, w * 0.04), Math.min(h * 0.09, Math.max(frameFont, 8 * fontScale)));
        cx.font = `600 ${frameFont}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(text, Math.max(w * 0.46, minFont(46)), Math.min(h * 0.09, Math.max(frameFont, 8 * fontScale)), Math.max(1, w * 0.52));
      } else {
        cx.textBaseline = 'top'; cx.fillText(text, Math.min(8 * fontScale, w * 0.06), Math.min(5 * fontScale, h * 0.06), Math.max(1, w - minFont(16)));
      }
      cx.restore(); return;
    }
    const insetLeft = definition.geometry === 'pool' || definition.geometry === 'lane' ? w * 0.18 : Math.max(minFont(3), w * 0.05);
    const insetRight = Math.max(minFont(3), w * 0.05), maxWidth = Math.max(1, w - insetLeft - insetRight);
    const lines = text.split('\n').slice(0, 80).filter(line => !/^[-─━]{2,}$/.test(line.trim()));
    const wrapped: string[] = [];
    for (const line of lines) {
      if (!line) { wrapped.push(''); continue; }
      const words = line.split(/\s+/); let current = '';
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (current && cx.measureText(next).width > maxWidth) { wrapped.push(current); current = word; }
        else current = next;
      }
      if (current) wrapped.push(current);
    }
    const stereotype = typeof params.stereotype === 'string' ? params.stereotype : '';
    if (stereotype) wrapped.unshift(stereotype);
    const lineHeight = Math.min(fs * 1.28, Math.max(minFont(4), h / Math.max(2, wrapped.length + 0.4)));
    const visibleLines = Math.max(1, Math.floor((h - minFont(4)) / lineHeight));
    const clipped = wrapped.slice(0, visibleLines);
    if (definition.geometry === 'pool' || definition.geometry === 'lane') {
      cx.translate(w * 0.075, h / 2); cx.rotate(-Math.PI / 2);
      cx.fillText(clipped.join(' ').slice(0, 60), 0, 0, Math.max(1, h - minFont(10)));
    } else {
      const totalHeight = clipped.length * lineHeight;
      let y = (h - totalHeight) / 2 + lineHeight / 2;
      for (const line of clipped) {
        if (!line) { y += lineHeight; continue; }
        cx.fillText(line, insetLeft + maxWidth / 2, y, maxWidth);
        y += lineHeight;
      }
    }
    cx.restore();
  }

  private drawStructuredErTableLabel(shape: DiagramShape, definition: ShapeDefinition, rawColumns: unknown[]) {
    const cx = this.cx, w = shape.w, h = shape.h;
    const fontScale = Number.isFinite(shape.embeddedTextScale) ? Math.max(0.01, Math.min(64, shape.embeddedTextScale!)) : 1;
    const minFont = (size: number) => Math.max(1.25, size * fontScale);
    const fs = Math.max(1.25, Math.min(96, (shape.fs ?? 14) * fontScale));
    const columns = rawColumns.filter(isRecord).slice(0, 32);
    const layout = structuredTableLayout(h, columns.length + 1);
    const title = typeof shape.text === 'string' && shape.text.trim() ? shape.text.trim() : definition.label;
    const padX = Math.max(minFont(3), Math.min(10 * fontScale, w * 0.05));
    const maxWidth = Math.max(1, w - padX * 2);

    const isEditingThis = shape.id === this.editingId;
    const editingTarget = isEditingThis ? this.editingClassifierContext?.target : undefined;
    const editingColIdx = isEditingThis ? this.editingClassifierContext?.columnIndex : undefined;

    // 1. Shaded header background bar (StarUML / DBeaver / draw.io style)
    cx.save();
    cx.fillStyle = 'rgba(241, 245, 249, 0.85)';
    if (typeof cx.roundRect === 'function') {
      cx.beginPath();
      cx.roundRect(0, 0, w, layout.rowHeight, [4, 4, 0, 0]);
      cx.fill();
    } else {
      cx.fillRect(0, 0, w, layout.rowHeight);
    }
    // Header bottom border
    cx.beginPath();
    cx.moveTo(0, layout.rowHeight);
    cx.lineTo(w, layout.rowHeight);
    cx.strokeStyle = shape.stroke || '#2563eb';
    cx.lineWidth = Math.max(1.2, (shape.sw || 1.5) * 0.9);
    cx.stroke();
    cx.restore();

    // 2. Header text
    if (layout.rowHeight >= minFont(4) && editingTarget !== 'header') {
      cx.save();
      cx.fillStyle = shape.textColor ?? '#0f172a';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      const headerFs = Math.max(minFont(4), Math.min(fs * 1.05, layout.rowHeight * 0.58));
      cx.font = `700 ${headerFs}px Inter, 'Segoe UI', sans-serif`;

      const isView = definition.id === 'erd.view' || shape.params?.stereotype === 'view';
      if (isView) {
        const stereotypeFs = Math.max(minFont(3), headerFs * 0.72);
        cx.font = `500 ${stereotypeFs}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = '#64748b';
        cx.fillText('«view»', w / 2, layout.rowCenters[0] - headerFs * 0.38, maxWidth);
        cx.font = `700 ${headerFs * 0.88}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = shape.textColor ?? '#0f172a';
        cx.fillText(title, w / 2, layout.rowCenters[0] + stereotypeFs * 0.38, maxWidth);
      } else {
        cx.fillText(title, w / 2, layout.rowCenters[0], maxWidth);
      }
      cx.restore();
    }

    // 3. Find last Primary Key index to draw the standard IDEF1X / StarUML compartment divider
    const lastPkIndex = columns.findLastIndex(col => col.key === 'primary' || col.key === 'primary_foreign');

    // 4. Render rows with badges, column names, nullability, and types
    columns.forEach((column, index) => {
      const rowHeight = layout.rowHeight;
      if (rowHeight < minFont(4)) return;
      const rowTop = layout.dividerYs[index];
      const rowCenter = layout.rowCenters[index + 1];

      // Subtle zebra striping for alternating rows
      if (index % 2 === 1) {
        cx.save();
        cx.fillStyle = 'rgba(248, 250, 252, 0.45)';
        cx.fillRect(0, rowTop, w, rowHeight);
        cx.restore();
      }

      // If this column is currently being inline-edited, skip rendering text
      if (editingTarget === 'member' && index === editingColIdx) return;

      const key = typeof column.key === 'string' ? column.key : 'none';
      const isPfk = key === 'primary_foreign';
      const isPk = key === 'primary';
      const isFk = key === 'foreign';
      const isUk = key === 'unique';
      const isNotNull = column.nullable === false || column.notNull === true;

      const colFs = Math.max(minFont(3.5), Math.min(fs, rowHeight * 0.62));
      const badgeH = Math.max(10, Math.min(rowHeight * 0.72, colFs * 1.35));
      const badgeFs = Math.max(minFont(2.8), colFs * 0.74);

      let currentX = padX;

      // Key Badge pill (e.g. PK in amber, FK in blue, PK,FK in purple, UK in violet)
      if (isPfk || isPk || isFk || isUk) {
        const badgeLabel = isPfk ? 'PK,FK' : isPk ? 'PK' : isFk ? 'FK' : 'UK';
        const badgeBg = isPfk ? '#ede9fe' : isPk ? '#fef3c7' : isFk ? '#dbeafe' : '#f3e8ff';
        const badgeColor = isPfk ? '#6d28d9' : isPk ? '#b45309' : isFk ? '#1d4ed8' : '#7c3aed';
        const badgeBorder = isPfk ? '#ddd6fe' : isPk ? '#fcd34d' : isFk ? '#bfdbfe' : '#e9d5ff';

        cx.save();
        cx.font = `700 ${badgeFs}px 'SF Mono', Consolas, Inter, sans-serif`;
        const textW = cx.measureText(badgeLabel).width;
        const badgeW = textW + 6;
        const badgeY = rowCenter - badgeH / 2;

        cx.fillStyle = badgeBg;
        cx.strokeStyle = badgeBorder;
        cx.lineWidth = 0.8;
        if (typeof cx.roundRect === 'function') {
          cx.beginPath();
          cx.roundRect(currentX, badgeY, badgeW, badgeH, 3);
          cx.fill();
          cx.stroke();
        } else {
          cx.fillRect(currentX, badgeY, badgeW, badgeH);
          cx.strokeRect(currentX, badgeY, badgeW, badgeH);
        }

        cx.fillStyle = badgeColor;
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.fillText(badgeLabel, currentX + badgeW / 2, rowCenter);
        cx.restore();

        currentX += badgeW + 6;
      }

      // Column Name
      const name = typeof column.name === 'string' && column.name.trim() ? column.name.trim() : `column_${index + 1}`;
      const nameFs = colFs;
      cx.save();
      cx.font = `${(isPk || isPfk) ? '650' : '500'} ${nameFs}px Inter, 'Segoe UI', sans-serif`;
      cx.fillStyle = (isPk || isPfk) ? (shape.textColor ?? '#0f172a') : (shape.textColor ?? '#334155');
      cx.textAlign = 'left';
      cx.textBaseline = 'middle';

      // Reserve right space for data type
      const typeStr = typeof column.type === 'string' && column.type.trim() ? column.type.trim() : '';
      const typeFs = Math.max(minFont(3), colFs * 0.86);
      cx.font = `400 ${typeFs}px 'SF Mono', Consolas, monospace, sans-serif`;
      const typeW = typeStr ? cx.measureText(typeStr).width + 8 : 0;
      const notNullIndicatorW = isNotNull ? 12 : 0;

      const availNameW = Math.max(10, w - currentX - typeW - notNullIndicatorW - padX);
      cx.font = `${(isPk || isPfk) ? '650' : '500'} ${nameFs}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(name, currentX, rowCenter, availNameW);

      const nameMeasuredW = Math.min(availNameW, cx.measureText(name).width);
      const afterNameX = currentX + nameMeasuredW + 3;

      // Nullability indicator (mandatory asterisk *)
      if (isNotNull) {
        cx.font = `700 ${Math.max(minFont(3.2), colFs * 0.88)}px Inter, 'Segoe UI', sans-serif`;
        cx.fillStyle = '#ef4444';
        cx.fillText('*', afterNameX, rowCenter - 1);
      }
      cx.restore();

      // Column Data Type (right-aligned)
      if (typeStr) {
        cx.save();
        cx.font = `400 ${typeFs}px 'SF Mono', Consolas, monospace, sans-serif`;
        cx.fillStyle = '#64748b';
        cx.textAlign = 'right';
        cx.textBaseline = 'middle';
        cx.fillText(typeStr, w - padX, rowCenter, Math.max(10, w * 0.45));
        cx.restore();
      }

      // 5. Divider after last Primary Key (IDEF1X standard compartment divider)
      if (lastPkIndex >= 0 && lastPkIndex < columns.length - 1 && index === lastPkIndex) {
        const pkDividerY = layout.dividerYs[index + 1];
        cx.save();
        cx.beginPath();
        cx.moveTo(0, pkDividerY);
        cx.lineTo(w, pkDividerY);
        cx.strokeStyle = shape.stroke || '#2563eb';
        cx.lineWidth = Math.max(1.2, (shape.sw || 1.5) * 0.8);
        cx.stroke();
        cx.restore();
      }
    });
  }

  private drawStructuredClassifierLabel(shape: DiagramShape, definition: ShapeDefinition, rawClassifier: Record<string, unknown>) {
    const cx = this.cx, w = shape.w;
    const textCapabilities = diagramCapabilitiesFor(definition, this.getSemanticContextForShape(shape.id)).text;
    const fontScale = Number.isFinite(shape.embeddedTextScale) && (shape.embeddedTextScale ?? 0) > 0
      ? Math.max(0.25, Math.min(16, shape.embeddedTextScale!))
      : Math.sqrt((shape.w / Math.max(1, definition.width)) * (shape.h / Math.max(1, definition.height)));
    const baseFs = (shape.fs ?? 14) * Math.min(4, Math.max(0.4, fontScale));
    const typography = diagramTypography(textCapabilities.role ?? 'classifier', baseFs, textCapabilities.minFontSize ?? 12);
    const name = typeof shape.text === 'string' && shape.text.trim() ? shape.text.trim() : definition.label;
    const stereotype = typeof shape.params?.stereotype === 'string' ? shape.params.stereotype : '';
    const classifier = rawClassifier as unknown as UMLClassifierData;
    const measure = (value: string) => {
      cx.save();
      cx.font = `${typography.title}px Inter, 'Segoe UI', sans-serif`;
      const titleWidth = cx.measureText(value).width;
      cx.font = `${typography.body}px Inter, 'Segoe UI', sans-serif`;
      const bodyWidth = cx.measureText(value).width;
      cx.restore();
      return Math.max(titleWidth, bodyWidth);
    };
    const layout = classifierLayout(classifier, name, stereotype, typography.title, typography.body, measure);
    const isAbstractClass = definition.id === 'uml.abstract-class'
      || shape.params?.italicName === true
      || (shape.data?.classifier as Record<string, unknown> | undefined)?.isAbstract === true;
    const italicPrefix = isAbstractClass ? 'italic ' : '';

    const isEditingThis = shape.id === this.editingId;
    const editingTarget = isEditingThis ? this.editingClassifierContext?.target : undefined;
    const editingMemberId = isEditingThis ? this.editingClassifierContext?.memberId : undefined;

    cx.fillStyle = shape.textColor ?? '#1f2937'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    if (stereotype) {
      cx.font = `500 ${typography.secondary}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(stereotype, w / 2, 8 + typography.secondary / 2);
      if (editingTarget !== 'header') {
        cx.font = `${italicPrefix}600 ${typography.title}px Inter, 'Segoe UI', sans-serif`;
        cx.fillText(name, w / 2, layout.headerHeight - typography.title * 0.68);
      }
    } else if (editingTarget !== 'header') {
      cx.font = `${italicPrefix}600 ${typography.title}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(name, w / 2, layout.headerHeight / 2);
    }

    // UML 2.5 Template/Parameterized Class notation (dashed rectangle with template parameter e.g. <T>)
    const rawClassRecord = shape.data?.classifier as Record<string, unknown> | undefined;
    const templateParam = typeof shape.params?.template === 'string' && shape.params.template.trim()
      ? shape.params.template.trim()
      : typeof rawClassRecord?.templateParameter === 'string' && rawClassRecord.templateParameter.trim()
        ? rawClassRecord.templateParameter.trim() : '';
    if (templateParam) {
      cx.save();
      const tFs = Math.max(9.5, typography.body * 0.85);
      cx.font = `500 ${tFs}px Inter, 'Segoe UI', sans-serif`;
      const tPadX = 6, tPadY = 2;
      const tW = cx.measureText(templateParam).width + tPadX * 2;
      const tH = tFs * 1.3 + tPadY * 2;
      const tX = w - tW - 2;
      const tY = -tH * 0.45;
      cx.fillStyle = '#ffffff';
      cx.strokeStyle = shape.stroke ?? '#1f2937';
      cx.lineWidth = Math.max(0.75, shape.sw ?? 1);
      cx.setLineDash([3, 2.5]);
      cx.beginPath();
      cx.rect(tX, tY, tW, tH);
      cx.fill();
      cx.stroke();
      cx.setLineDash([]);
      cx.fillStyle = shape.textColor ?? '#1f2937';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(templateParam, tX + tW / 2, tY + tH / 2);
      cx.restore();
    }

    cx.strokeStyle = shape.stroke ?? '#1f2937'; cx.lineWidth = Math.max(0.75, shape.sw ?? 1);
    for (const y of new Set(layout.dividers)) {
      if (y > 0 && y < shape.h - 0.25) { cx.beginPath(); cx.moveTo(0, y); cx.lineTo(w, y); cx.stroke(); }
    }
    cx.textAlign = 'left'; cx.textBaseline = 'middle';
    for (const row of layout.rows) {
      if (editingTarget === 'member' && row.member.id === editingMemberId) continue;
      const member = row.member;
      const italic = member.kind === 'operation' && member.abstract === true;
      cx.font = `${italic ? 'italic ' : ''}${typography.body}px Inter, 'Segoe UI', sans-serif`;
      cx.fillStyle = shape.textColor ?? '#1f2937';
      cx.fillText(row.text, layout.paddingX, row.y);
      if ((member.kind === 'attribute' || member.kind === 'operation') && member.static === true) {
        const textWidth = cx.measureText(row.text).width;
        const underlineY = row.y + typography.body * 0.48;
        cx.beginPath(); cx.moveTo(layout.paddingX, underlineY); cx.lineTo(layout.paddingX + textWidth, underlineY);
        cx.strokeStyle = shape.textColor ?? '#1f2937'; cx.lineWidth = Math.max(0.75, typography.body / 16); cx.stroke();
      }
    }
  }

  private drawStructuredInstanceLabel(shape: DiagramShape, definition: ShapeDefinition, rawInstance: Record<string, unknown>) {
    const cx = this.cx, w = shape.w;
    const textCapabilities = diagramCapabilitiesFor(definition).text;
    const minimum = textCapabilities.minFontSize ?? 12;
    const fontScale = Number.isFinite(shape.embeddedTextScale) && (shape.embeddedTextScale ?? 0) > 0
      ? Math.max(0.25, Math.min(16, shape.embeddedTextScale!))
      : Math.sqrt((shape.w / Math.max(1, definition.width)) * (shape.h / Math.max(1, definition.height)));
    const baseFs = (shape.fs ?? 14) * Math.min(4, Math.max(0.4, fontScale));
    const typography = diagramTypography(textCapabilities.role ?? 'classifier', baseFs, minimum);
    const name = typeof shape.text === 'string' && shape.text.trim() ? shape.text.trim() : definition.label;
    const instance = rawInstance as unknown as import('./shapes/types').UMLInstanceData;
    const layout = instanceLayout(instance, name, typography.title, typography.body, value => cx.measureText(value).width);

    const isEditingThis = shape.id === this.editingId;
    const editingTarget = isEditingThis ? this.editingClassifierContext?.target : undefined;
    const editingMemberId = isEditingThis ? this.editingClassifierContext?.memberId : undefined;

    if (editingTarget !== 'header') {
      cx.fillStyle = shape.textColor ?? '#1f2937'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.font = `600 ${typography.title}px Inter, 'Segoe UI', sans-serif`;
      cx.fillText(name, w / 2, layout.headerHeight / 2);
      // UML 2.5: Object instance names are strictly underlined
      const textWidth = cx.measureText(name).width;
      const underlineY = layout.headerHeight / 2 + typography.title * 0.48;
      cx.beginPath(); cx.moveTo(w / 2 - textWidth / 2, underlineY); cx.lineTo(w / 2 + textWidth / 2, underlineY);
      cx.strokeStyle = shape.textColor ?? '#1f2937'; cx.lineWidth = Math.max(0.75, typography.title / 16); cx.stroke();
    }
    cx.strokeStyle = shape.stroke ?? '#1f2937'; cx.lineWidth = Math.max(0.75, shape.sw ?? 1);
    cx.beginPath(); cx.moveTo(0, layout.headerHeight); cx.lineTo(w, layout.headerHeight); cx.stroke();
    cx.textAlign = 'left'; cx.textBaseline = 'middle'; cx.font = `${typography.body}px Inter, 'Segoe UI', sans-serif`;
    for (const row of layout.rows) {
      if (editingTarget === 'member' && row.member.id === editingMemberId) continue;
      cx.fillStyle = shape.textColor ?? '#1f2937';
      cx.fillText(row.text, layout.paddingX, row.y);
    }
  }

  private connectorLabelVisuals(connector: ConnectorShape, route = getConnectorRoute(connector)): ConnectorLabelVisual[] {
    const cx = this.cx, definition = getShapeDefinition(connector.shapeId);
    const capabilities = diagramCapabilitiesFor(definition, this.getSemanticContextForShape(connector.id));
    const connectorCaps = capabilities.connector ?? {};
    const fontSize = definition?.semantic?.notation === 'uml'
      ? diagramTypography(capabilities.text.role ?? 'connector-label', 14, capabilities.text.minFontSize ?? 12).connector : 12;
    cx.save(); cx.font = `${fontSize}px Inter, 'Segoe UI', sans-serif`;
    const centerText = connectorCaps.labelMode === 'none' ? '' : connectorDisplayLabel(connector);
    const legacyMultiplicity = (value: Cardinality | undefined) => value === 'one' ? '1'
      : value === 'zero-or-one' ? '0..1' : value === 'many' ? '*' : value === 'one-or-many' ? '1..*'
        : value === 'zero-or-many' ? '0..*' : '';
    const sourceMultiplicity = connector.sourceMultiplicity ?? (connectorCaps.multiplicityEditable ? legacyMultiplicity(connector.sourceCardinality) : '');
    const targetMultiplicity = connector.targetMultiplicity ?? (connectorCaps.multiplicityEditable ? legacyMultiplicity(connector.targetCardinality) : '');
    const isUmlRelationship = definition?.semantic?.family === 'uml.relationship-edge'
      || definition?.semantic?.family === 'uml.usecase-dependency';
    const laneAwareOffset = (value: number) => parallelConnectorLabelOffset(value, connector.parallelLane, isUmlRelationship);
    const entries: Array<{ kind: ConnectorLabelKind; raw: string; position?: number; offset?: number; editable: boolean }> = [
      { kind: 'center', raw: centerText, position: connector.labelPosition,
        offset: connector.labelOffset !== undefined ? laneAwareOffset(connector.labelOffset) : undefined,
        editable: connectorCaps.labelMode === 'plain' },
      { kind: 'source', raw: connector.sourceLabel ?? '', position: connector.sourceLabelPosition ?? 180,
        offset: laneAwareOffset(connector.sourceLabelOffset ?? 12), editable: connectorCaps.sourceLabelEditable === true },
      { kind: 'target', raw: connector.targetLabel ?? '', position: connector.targetLabelPosition ?? 820,
        offset: laneAwareOffset(connector.targetLabelOffset ?? 12), editable: connectorCaps.targetLabelEditable === true },
      { kind: 'source-multiplicity', raw: sourceMultiplicity, position: 100, offset: laneAwareOffset(-12), editable: false },
      { kind: 'target-multiplicity', raw: targetMultiplicity, position: 900, offset: laneAwareOffset(-12), editable: false },
    ];
    const visuals = entries.filter(entry => entry.raw.trim()
      && (entry.kind === 'center' && connectorCaps.labelMode !== 'none'
        || entry.kind === 'source' && connectorCaps.sourceLabelEditable === true
        || entry.kind === 'target' && connectorCaps.targetLabelEditable === true
        || entry.kind === 'source-multiplicity' && connectorCaps.multiplicityEditable === true
        || entry.kind === 'target-multiplicity' && connectorCaps.multiplicityEditable === true))
      .map(entry => {
        const text = fitConnectorLabel(entry.raw, value => cx.measureText(value).width);
        const lines = text.split('\n');
        const textWidth = Math.min(280, Math.max(12, ...lines.map(line => cx.measureText(line).width)));
        const layout = connectorLabelLayout(route, { startMarker: connector.startMarker, endMarker: connector.endMarker,
          sourceCardinality: connectorCaps.multiplicityEditable ? undefined : connector.sourceCardinality,
          targetCardinality: connectorCaps.multiplicityEditable ? undefined : connector.targetCardinality,
          strokeWidth: connector.sw, labelWidth: textWidth, labelHeight: Math.max(CONNECTOR_LABEL_HEIGHT, lines.length * fontSize * 1.25),
          ...(entry.position !== undefined ? { labelPosition: entry.position } : {}),
          ...(entry.offset !== undefined ? { labelOffset: entry.offset } : {}) });
        const positionEditable = connectorCaps.labelPositionEditable === true
          && (entry.kind === 'center' || entry.kind === 'source' || entry.kind === 'target');
        return { kind: entry.kind, editable: entry.editable, positionEditable, text, x: layout.x, y: layout.y,
          width: layout.width, height: layout.height, textWidth, fontSize };
      });
    cx.restore();
    return visuals;
  }

  private drawConnectorTargetFeedback(feedback: ConnectorTargetFeedback) {
    const shape = this.shapes.get(feedback.shapeId);
    if (!shape || !isConnectableShape(shape) || !('x' in shape && 'y' in shape && 'w' in shape && 'h' in shape)) return;
    const definition = this.definitionForEndpoint(shape);
    if (!definition) return;
    const diagram = (shape.type === 'diagram' ? shape : {
      ...shape, type: 'diagram', shapeId: definition.id,
      params: { ...(definition.defaultParams ?? {}), ...((shape as BoxShape).params ?? {}) },
      fill: 'transparent', stroke: definition.defaultStroke ?? '#2563eb', sw: 1.5,
      text: '', fs: 14, textColor: '#1f2937',
    }) as DiagramShape;
    const cx = this.cx, zoom = Math.max(0.04, this.cam.zoom), color = feedback.valid ? '#15803d' : '#dc2626';
    const solid = Boolean(getShapeDefinition(diagram.shapeId)?.solid3d);
    cx.save();
    if ((diagram.rotation ?? 0) !== 0) {
      const centerX = solid ? diagram.x : diagram.x + diagram.w / 2;
      const centerY = solid ? diagram.y : diagram.y + diagram.h / 2;
      cx.translate(centerX, centerY); cx.rotate((diagram.rotation ?? 0) * Math.PI / 180); cx.translate(-centerX, -centerY);
    }
    const geometry = this.cachedDiagramGeometry(diagram);
    cx.translate(diagram.x, diagram.y);
    cx.save();
    cx.strokeStyle = color; cx.lineWidth = 3 / zoom; cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.setLineDash([]); cx.shadowColor = color; cx.shadowBlur = 8 / zoom;
    if (geometry.path) cx.stroke(geometry.path);
    else { drawPathCommands(cx, geometry.outline); cx.stroke(); }
    geometry.decorationPaths?.forEach(path => { if (path) cx.stroke(path); });
    cx.restore();
    cx.restore();

    const radius = 7 / zoom;
    cx.save();
    cx.beginPath(); cx.arc(feedback.point.x, feedback.point.y, radius, 0, Math.PI * 2);
    cx.fillStyle = '#ffffff'; cx.fill(); cx.strokeStyle = color; cx.lineWidth = 2.5 / zoom; cx.stroke();
    cx.beginPath();
    if (feedback.valid) {
      cx.moveTo(feedback.point.x - radius * 0.42, feedback.point.y + radius * 0.01);
      cx.lineTo(feedback.point.x - radius * 0.08, feedback.point.y + radius * 0.36);
      cx.lineTo(feedback.point.x + radius * 0.48, feedback.point.y - radius * 0.38);
    } else {
      cx.moveTo(feedback.point.x - radius * 0.34, feedback.point.y - radius * 0.34);
      cx.lineTo(feedback.point.x + radius * 0.34, feedback.point.y + radius * 0.34);
      cx.moveTo(feedback.point.x + radius * 0.34, feedback.point.y - radius * 0.34);
      cx.lineTo(feedback.point.x - radius * 0.34, feedback.point.y + radius * 0.34);
    }
    cx.strokeStyle = color; cx.lineWidth = 1.8 / zoom; cx.lineCap = 'round'; cx.stroke();
    const label = feedback.valid ? 'Compatible target' : 'Invalid endpoint';
    cx.font = `${12 / zoom}px Inter, 'Segoe UI', sans-serif`;
    const width = cx.measureText(label).width + 14 / zoom, height = 22 / zoom;
    const left = feedback.point.x + 12 / zoom, top = feedback.point.y - height - 5 / zoom;
    cx.fillStyle = '#ffffff'; cx.strokeStyle = color; cx.lineWidth = 1 / zoom;
    cx.beginPath(); cx.roundRect(left, top, width, height, 5 / zoom); cx.fill(); cx.stroke();
    cx.fillStyle = color; cx.textAlign = 'left'; cx.textBaseline = 'middle';
    cx.fillText(label, left + 7 / zoom, top + height / 2, width - 12 / zoom);
    cx.restore();
  }

  private drawConnectorShape(connector: ConnectorShape) {
    const cx = this.cx, def = getShapeDefinition(connector.shapeId);
    if (!def) return;
    const points = getConnectorRoute(connector);
    cx.save(); cx.strokeStyle = connector.color; cx.fillStyle = connector.color; cx.lineWidth = Math.max(0.5, connector.sw);
    cx.lineCap = 'round'; cx.lineJoin = 'round';
    cx.setLineDash(connector.lineStyle === 'dashed' ? [8, 5] : connector.lineStyle === 'dotted' ? [2, 4] : []);
    const isTotalParticipation = connector.erdParticipation === 'total';
    if (isTotalParticipation && points.length >= 2) {
      const gap = 1.75;
      for (const sign of [-1, 1]) {
        cx.beginPath();
        for (let i = 0; i < points.length; i++) {
          let nx = 0, ny = 0;
          if (i === 0) {
            const dx = points[1][0] - points[0][0], dy = points[1][1] - points[0][1];
            const len = Math.hypot(dx, dy) || 1;
            nx = -dy / len; ny = dx / len;
          } else if (i === points.length - 1) {
            const dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1];
            const len = Math.hypot(dx, dy) || 1;
            nx = -dy / len; ny = dx / len;
          } else {
            const dx1 = points[i][0] - points[i - 1][0], dy1 = points[i][1] - points[i - 1][1];
            const len1 = Math.hypot(dx1, dy1) || 1;
            const dx2 = points[i + 1][0] - points[i][0], dy2 = points[i + 1][1] - points[i][1];
            const len2 = Math.hypot(dx2, dy2) || 1;
            nx = (-dy1 / len1 + -dy2 / len2) / 2;
            ny = (dx1 / len1 + dx2 / len2) / 2;
            const norm = Math.hypot(nx, ny) || 1;
            nx /= norm; ny /= norm;
          }
          const px = points[i][0] + nx * gap * sign;
          const py = points[i][1] + ny * gap * sign;
          if (i === 0) cx.moveTo(px, py);
          else cx.lineTo(px, py);
        }
        cx.stroke();
      }
    } else {
      cx.beginPath();
      cx.moveTo(points[0][0], points[0][1]);
      for (let index = 1; index < points.length; index++) cx.lineTo(points[index][0], points[index][1]);
      cx.stroke();
    }
    cx.setLineDash([]);
    const labelVisuals = this.connectorLabelVisuals(connector, points);
    for (const label of labelVisuals) {
      cx.save();
      const lines = label.text.split('\n');
      const isStereotypeOrCenter = connector.shapeId === 'uml.include' || connector.shapeId === 'uml.extend'
        || connector.shapeId === 'uml-usage' || label.kind === 'center';

      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      const lineHeight = label.fontSize * 1.28;
      const startY = label.y - (lines.length - 1) * lineHeight / 2;

      lines.forEach((lineText, lineIndex) => {
        const lineY = startY + lineIndex * lineHeight;
        if (isStereotypeOrCenter) {
          cx.font = lineIndex === 0
            ? `600 ${label.fontSize}px Inter, 'Segoe UI', sans-serif`
            : `500 ${Math.max(9.5, label.fontSize * 0.88)}px Inter, 'Segoe UI', sans-serif`;
        } else {
          cx.font = `500 ${label.fontSize}px Inter, 'Segoe UI', sans-serif`;
        }
        cx.fillStyle = connector.color;
        cx.fillText(lineText, label.x, lineY);
      });
      cx.restore();
    }
    // Markers are painted after labels so a short-route glyph can never erase an endpoint.
    const firstNext = points[1] ?? [connector.x2, connector.y2];
    const lastPrevious = points.at(-2) ?? [connector.x1, connector.y1];
    const startAngle = Math.atan2(points[0][1] - firstNext[1], points[0][0] - firstNext[0]);
    const endAngle = Math.atan2(points.at(-1)![1] - lastPrevious[1], points.at(-1)![0] - lastPrevious[0]);
    const connectorCapabilities = diagramCapabilitiesFor(def, this.getSemanticContextForShape(connector.id)).connector;
    const markerSourceCardinality = connectorCapabilities?.multiplicityEditable ? undefined : connector.sourceCardinality;
    const markerTargetCardinality = connectorCapabilities?.multiplicityEditable ? undefined : connector.targetCardinality;
    this.drawEndpointMarker(connector.startMarker, connector.x1, connector.y1, startAngle, connector.sw, connector.color, markerSourceCardinality);
    this.drawEndpointMarker(connector.endMarker, connector.x2, connector.y2, endAngle, connector.sw, connector.color, markerTargetCardinality);
    cx.restore();
  }

  private drawEndpointMarker(marker: EndpointMarker, x: number, y: number, angle: number, width: number, color: string, cardinality?: string) {
    const cx = this.cx;
    if (cardinality) {
      drawCardinalityMarker(cx, cardinality, x, y, angle, Math.max(9, width * 3), color);
      return;
    }
    if (marker === 'none') return;
    const size = Math.max(8, width * 3.1), ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
    const baseX = x - ux * size, baseY = y - uy * size;
    cx.save(); cx.lineWidth = Math.max(1, width); cx.strokeStyle = String(cx.strokeStyle); cx.fillStyle = ['hollowTriangle', 'diamond', 'circle', 'zeroOrOne'].includes(marker) ? '#ffffff' : marker === 'filledCircle' ? color : String(cx.fillStyle);
    if (marker === 'bar') {
      cx.beginPath(); cx.moveTo(x + nx * size * 0.42, y + ny * size * 0.42); cx.lineTo(x - nx * size * 0.42, y - ny * size * 0.42); cx.stroke();
    } else if (marker === 'circle' || marker === 'filledCircle' || marker === 'zeroOrOne') {
      if (marker === 'filledCircle') cx.fillStyle = color;
      cx.beginPath(); cx.arc(x - ux * size * 0.5, y - uy * size * 0.5, size * 0.35, 0, Math.PI * 2); cx.fill(); cx.stroke();
      if (marker === 'zeroOrOne') drawEndpointMarkerAt(cx, 'bar', baseX - ux * size * 0.15, baseY - uy * size * 0.15, angle, size * 0.45);
    } else if (marker === 'crowFoot') {
      drawCrowFoot(cx, x, y, angle, size);
    } else if (marker === 'openArrow') {
      const half = size * 0.43;
      const tip: [number, number] = [x, y];
      const left: [number, number] = [baseX + nx * half, baseY + ny * half];
      const right: [number, number] = [baseX - nx * half, baseY - ny * half];
      cx.beginPath(); cx.moveTo(...left); cx.lineTo(...tip); cx.lineTo(...right); cx.stroke();
    } else if (marker === 'diamond' || marker === 'filledDiamond') {
      const tip: [number, number] = [x, y];
      const nearLeft: [number, number] = [baseX + nx * size * 0.52, baseY + ny * size * 0.52];
      const back: [number, number] = [x - ux * size * 1.7, y - uy * size * 1.7];
      const nearRight: [number, number] = [baseX - nx * size * 0.52, baseY - ny * size * 0.52];
      cx.beginPath(); cx.moveTo(...tip); cx.lineTo(...nearLeft); cx.lineTo(...back); cx.lineTo(...nearRight); cx.closePath();
      if (marker === 'diamond') cx.fillStyle = '#ffffff';
      cx.fill(); cx.stroke();
    } else {
      const half = size * 0.43;
      const tip: [number, number] = [x, y];
      const left: [number, number] = [baseX + nx * half, baseY + ny * half];
      const right: [number, number] = [baseX - nx * half, baseY - ny * half];
      cx.beginPath(); cx.moveTo(...tip); cx.lineTo(...left); cx.lineTo(...right); cx.closePath();
      if (marker === 'arrow' || marker === 'blockArrow') cx.fill();
      else { cx.fill(); cx.stroke(); }
    }
    cx.restore();
  }

  private drawShape(s: AnyShape) {
    const cx = this.cx;
    cx.save();
    if (isRotatableBox(s) && (s.rotation ?? 0) !== 0) {
      const box = s as BoxShape;
      const solid = box.type === 'diagram' && Boolean(getShapeDefinition((box as DiagramShape).shapeId)?.solid3d);
      const centerX = solid ? box.x : box.x + box.w / 2;
      const centerY = solid ? box.y : box.y + box.h / 2;
      cx.translate(centerX, centerY); cx.rotate((box.rotation ?? 0) * Math.PI / 180); cx.translate(-centerX, -centerY);
    }
    if (s.type !== 'diagram' && s.type !== 'connector' && !('vertices' in s && Array.isArray(s.vertices) && s.vertices.length >= 3)) {
      const definition = getShapeDefinitionForLegacyType(s.type);
      if (definition?.kind === 'shape' && 'x' in s && 'y' in s && 'w' in s && 'h' in s && 'fill' in s && 'stroke' in s) {
        const legacyShape = s as BoxShape & { fill: string; stroke: string; sw?: number };
        this.drawDiagramShape({ ...legacyShape, type: 'diagram', shapeId: definition.id,
          params: { ...(definition.defaultParams ?? {}), ...(legacyShape.params ?? {}) },
          fill: legacyShape.fill, stroke: legacyShape.stroke, sw: legacyShape.sw ?? 2,
          text: legacyShape.text ?? '', fs: legacyShape.fs ?? this.style.fontSize,
          textColor: legacyShape.textColor ?? '#1f2937', embeddedTextScale: legacyShape.embeddedTextScale,
        } as DiagramShape);
        cx.restore();
        return;
      }
    }

    switch (s.type) {
      case 'pen': {
        const hasMeasuredPressure = s.pts.some(point => Number.isFinite(point[2]) && Math.abs(point[2]! - 0.5) > 0.02);
        const outline = getStroke(s.pts, {
          size: Math.max(0.1, s.size),
          thinning: hasMeasuredPressure ? 0.20 : 0, // Zero thinning on mouse -> uniform width, no pinching or distorted wiggles
          smoothing: 0.50,
          streamline: 0.08, // Low streamline -> follows cursor faithfully without lagging or shrinking wiggles
          easing: pressure => pressure,
          simulatePressure: false,
          start: { cap: true, taper: 0 },
          end: { cap: true, taper: 0 },
          last: true,
        });
        if (!outline.length) break;
        cx.fillStyle = s.color;
        if (outline.length < 4) {
          const point = s.pts[0];
          if (point) {
            cx.beginPath(); cx.arc(point[0], point[1], Math.max(0.5, s.size / 2), 0, Math.PI * 2); cx.fill();
          }
          break;
        }
        const path = new Path2D();
        const first = outline[0], second = outline[1];
        path.moveTo((first[0] + second[0]) / 2, (first[1] + second[1]) / 2);
        for (let index = 1; index < outline.length; index++) {
          const control = outline[index], next = outline[(index + 1) % outline.length];
          path.quadraticCurveTo(control[0], control[1], (control[0] + next[0]) / 2, (control[1] + next[1]) / 2);
        }
        path.closePath();
        cx.fill(path);
        break;
      }
      case 'line': {
        const line = s as LineShape;
        cx.strokeStyle = line.color; cx.lineWidth = line.sw; cx.lineCap = 'round';
        cx.beginPath(); cx.moveTo(line.x1, line.y1); cx.lineTo(line.x2, line.y2); cx.stroke();
        break;
      }
      case 'curve': {
        const curve = s as CurveShape;
        if (curve.pts.length < 2) break;
        cx.strokeStyle = curve.color; cx.lineWidth = curve.sw; cx.lineCap = 'round'; cx.lineJoin = 'round';
        cx.beginPath(); cx.moveTo(curve.pts[0][0], curve.pts[0][1]);
        for (let index = 0; index < curve.pts.length - 1; index++) {
          const previous = curve.pts[Math.max(0, index - 1)];
          const current = curve.pts[index];
          const next = curve.pts[index + 1];
          const following = curve.pts[Math.min(curve.pts.length - 1, index + 2)];
          cx.bezierCurveTo(
            current[0] + (next[0] - previous[0]) / 6,
            current[1] + (next[1] - previous[1]) / 6,
            next[0] - (following[0] - current[0]) / 6,
            next[1] - (following[1] - current[1]) / 6,
            next[0], next[1],
          );
        }
        cx.stroke();
        break;
      }
      case 'diagram': {
        this.drawDiagramShape(s as DiagramShape);
        break;
      }
      case 'connector': {
        this.drawConnectorShape(s as ConnectorShape);
        break;
      }
      case 'rect': {
        const shape = s as RectShape; const [rx,ry,rw,rh]=nr(shape.x,shape.y,shape.w,shape.h);
        cx.fillStyle=shape.fill; cx.strokeStyle=shape.stroke; cx.lineWidth=shape.sw;
        if (shape.vertices?.length === 4) {
          const vertices = getShapeVertices(shape, false);
          cx.beginPath(); cx.moveTo(vertices[0][0], vertices[0][1]);
          vertices.slice(1).forEach(([x, y]) => cx.lineTo(x, y));
          cx.closePath();
        } else {
          cx.beginPath(); cx.roundRect(rx,ry,rw,rh,0);
        }
        cx.fill(); if(shape.sw>0) cx.stroke(); break;
      }
      case 'rounded-rect': {
        const shape = s as RectShape; const {x,y,w,h,fill,stroke,sw} = shape; const [rx,ry,rw,rh]=nr(x,y,w,h);
        const radius = Number.isFinite(shape.params?.cornerRadius) ? Number(shape.params?.cornerRadius) : 16;
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.roundRect(rx,ry,rw,rh,Math.max(0, Math.min(radius, Math.min(rw, rh) / 2))); cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'ellipse': {
        const {x,y,w,h,fill,stroke,sw} = s; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.ellipse(rx+rw/2,ry+rh/2,rw/2,rh/2,0,0,Math.PI*2);
        cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'triangle': {
        const shape = s as TriShape;
        const vertices = getShapeVertices(shape, false);
        cx.fillStyle=shape.fill; cx.strokeStyle=shape.stroke; cx.lineWidth=shape.sw;
        cx.beginPath(); cx.moveTo(vertices[0][0], vertices[0][1]);
        vertices.slice(1).forEach(([x, y]) => cx.lineTo(x, y));
        cx.closePath(); cx.fill(); if(shape.sw>0) cx.stroke(); break;
      }
      case 'diamond': {
        const {x,y,w,h,fill,stroke,sw} = s; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.moveTo(rx+rw/2,ry); cx.lineTo(rx+rw,ry+rh/2); cx.lineTo(rx+rw/2,ry+rh); cx.lineTo(rx,ry+rh/2); cx.closePath();
        cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'star': {
        const {x,y,w,h,fill,stroke,sw} = s as StarShape; const [rx,ry,rw,rh]=nr(x,y,w,h);
        const pcx=rx+rw/2, pcy=ry+rh/2, ro=Math.min(rw,rh)/2, ri=ro*0.42;
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath();
        for(let i=0;i<10;i++){
          const r=i%2===0?ro:ri, a=(i*Math.PI/5)-Math.PI/2;
          const px=pcx+r*Math.cos(a), py=pcy+r*Math.sin(a);
          if(i===0) cx.moveTo(px,py); else cx.lineTo(px,py);
        }
        cx.closePath(); cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'callout': {
        const {x,y,w,h,fill,stroke,sw} = s as CalloutShape; const [rx,ry,rw,rh]=nr(x,y,w,h);
        cx.fillStyle=fill; cx.strokeStyle=stroke; cx.lineWidth=sw;
        cx.beginPath(); cx.roundRect(rx,ry,rw,rh,8);
        cx.moveTo(rx+20, ry+rh); cx.lineTo(rx+10, ry+rh+20); cx.lineTo(rx+30, ry+rh);
        cx.fill(); if(sw>0) cx.stroke(); break;
      }
      case 'pentagon': case 'hexagon': case 'parallelogram': case 'trapezoid': case 'right-triangle': {
        const shape = s as PolygonShape;
        const vertices = getShapeVertices(shape, false);
        if (vertices.length < 3) break;
        cx.fillStyle = shape.fill; cx.strokeStyle = shape.stroke; cx.lineWidth = shape.sw;
        cx.beginPath(); cx.moveTo(vertices[0][0], vertices[0][1]);
        for (let index = 1; index < vertices.length; index++) cx.lineTo(vertices[index][0], vertices[index][1]);
        cx.closePath(); cx.fill(); if (shape.sw > 0) cx.stroke(); break;
      }
      case 'arrow': {
        const {x1,y1,x2,y2,color,sw}=s;
        cx.strokeStyle=color; cx.fillStyle=color; cx.lineWidth=sw; cx.lineCap='round';
        cx.beginPath(); cx.moveTo(x1,y1); cx.lineTo(x2,y2); cx.stroke();
        const ang=Math.atan2(y2-y1,x2-x1), AL=10+sw*3;
        cx.beginPath(); cx.moveTo(x2,y2);
        cx.lineTo(x2-AL*Math.cos(ang-0.42),y2-AL*Math.sin(ang-0.42));
        cx.lineTo(x2-AL*Math.cos(ang+0.42),y2-AL*Math.sin(ang+0.42));
        cx.closePath(); cx.fill(); break;
      }
      case 'sticky':
      case 'text':
      case 'math':
      case 'code': {
        // Shapes with heavily stylized HTML elements, fonts, backgrounds, flexbox wraps (like sticky, text, code, math)
        // have been fully shifted to be natively rendered by DOM in sync with their overlay HTML counterparts
        // Thus their visual rendering code is fully abstracted outwards resolving any cross Z-index Canvas/DOM layer tearing
        break;
      }
      case 'image': {
        // Rendered via HTML overlay for z-ordering consistency
        break;
      }
    }
    // DOM-backed content (text, sticky, math, code, image) has exactly one authoritative
    // visual owner: the sibling overlay. Do not also paint its source/label onto this canvas.
    if (!isDomOverlayShape(s) && s.type !== 'diagram' && isLabelEditableShape(s) && 'x' in s && 'w' in s
      && 'text' in s && typeof s.text === 'string' && s.text.length) {
      const box = s as BoxShape, fs = box.fs ?? 14;
      cx.fillStyle = box.textColor ?? '#1f2937'; cx.font = `${fs}px Inter, 'Segoe UI', sans-serif`;
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      const lines = String(box.text).split('\n').slice(0, 80), lineHeight = Math.min(fs * 1.25, box.h / Math.max(1, lines.length));
      let y = box.y + box.h / 2 - lineHeight * (lines.length - 1) / 2;
      for (const line of lines) { cx.fillText(line, box.x + box.w / 2, y, Math.max(8, box.w - 16)); y += lineHeight; }
    }
    cx.restore();
  }

  private drawSelection(shape: AnyShape) {
    if (this.editingId && shape.id === this.editingId) return;
    if (['sticky', 'text', 'math', 'code', 'image'].includes(shape.type)) return; // DOM overlays own their focus/selection chrome.
    const { cx, cam } = this, zoom = Math.max(0.04, cam.zoom), handleRadius = 5 / zoom;
    cx.save(); cx.strokeStyle = '#3b82f6'; cx.fillStyle = '#ffffff'; cx.lineWidth = 2 / zoom;
    cx.setLineDash([5 / zoom, 4 / zoom]);
    if (shape.type === 'connector') {
      const connector = shape as ConnectorShape, points = getConnectorRoute(connector);
      const capabilities = diagramCapabilitiesFor(getShapeDefinition(connector.shapeId), this.getSemanticContextForShape(connector.id));
      cx.beginPath(); cx.moveTo(points[0][0], points[0][1]);
      for (let index = 1; index < points.length; index++) cx.lineTo(points[index][0], points[index][1]);
      cx.stroke(); cx.setLineDash([]);
      const handles: [number, number][] = [[connector.x1, connector.y1], [connector.x2, connector.y2],
        ...(capabilities.connector?.routeEditable !== false ? connector.waypoints : [])];
      for (const [x, y] of handles) {
        cx.beginPath(); cx.arc(x, y, handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      if (capabilities.transform.rotate && hasConnectorRotationHandle(connector)) {
        const rotate = { x: (shape.minX + shape.maxX) / 2, y: shape.minY - 24 / zoom };
        cx.beginPath(); cx.moveTo((shape.minX + shape.maxX) / 2, shape.minY); cx.lineTo(rotate.x, rotate.y); cx.stroke();
        cx.setLineDash([]); cx.beginPath(); cx.arc(rotate.x, rotate.y, handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      for (const label of this.connectorLabelVisuals(connector).filter(visual => visual.positionEditable)) {
        cx.beginPath(); cx.arc(label.x, label.y, handleRadius * 0.9, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      cx.restore(); return;
    }
    if (shape.type === 'line' || shape.type === 'arrow') {
      const line = shape as LineShape | ArrowShape;
      cx.beginPath(); cx.moveTo(line.x1, line.y1); cx.lineTo(line.x2, line.y2); cx.stroke(); cx.setLineDash([]);
      for (const [x, y] of [[line.x1, line.y1], [line.x2, line.y2]]) {
        cx.beginPath(); cx.arc(x, y, handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      cx.restore(); return;
    }
    if ('x' in shape && 'w' in shape) {
      const box = shape as BoxShape;
      const diagramDefinition = box.type === 'diagram' ? getShapeDefinition((box as DiagramShape).shapeId) : undefined;
      const capabilities = diagramCapabilitiesFor(diagramDefinition);
      const solidShape = box.type === 'diagram' && diagramDefinition?.solid3d ? box as DiagramShape : null;
      if (solidShape) {
        this.drawSolidSelection(solidShape);
        cx.restore(); return;
      }
      const corners = rotatedBoxCorners(box);
      cx.beginPath(); cx.moveTo(corners[0][0], corners[0][1]);
      for (let index = 1; index < corners.length; index++) cx.lineTo(corners[index][0], corners[index][1]);
      cx.closePath(); cx.stroke(); cx.setLineDash([]);
      for (const [, x, y] of getNotationResizeHandles(box, capabilities)) {
        cx.beginPath(); cx.arc(x, y, handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      if (capabilities.transform.rotate) {
        const topMid = objectPointToWorld(box, { x: box.w / 2, y: 0 });
        const rotate = getRotationHandlePoint(box, zoom);
        cx.beginPath(); cx.moveTo(topMid.x, topMid.y); cx.lineTo(rotate[0], rotate[1]); cx.stroke();
        cx.beginPath(); cx.arc(rotate[0], rotate[1], handleRadius, 0, Math.PI * 2); cx.fill(); cx.stroke();
      }
      cx.restore(); return;
    }
    const width = Math.max(0, shape.maxX - shape.minX), height = Math.max(0, shape.maxY - shape.minY);
    cx.setLineDash([]); cx.strokeRect(shape.minX, shape.minY, width, height);
    cx.restore();
  }

  private drawSolidSelection(shape: DiagramShape) {
    const { cx, cam } = this, zoom = Math.max(0.04, cam.zoom);
    const cached = this.cachedDiagramGeometry(shape);
    const projectionObj = cached.projection as { projectedBounds?: { minX: number; minY: number; maxX: number; maxY: number } } | undefined;
    const bounds = projectionObj?.projectedBounds ?? {
      minX: -shape.w / 2, minY: -shape.h / 2, maxX: shape.w / 2, maxY: shape.h / 2,
    };

    cx.save();
    cx.translate(shape.x, shape.y);
    if ((shape.rotation ?? 0) !== 0) {
      cx.rotate((shape.rotation ?? 0) * Math.PI / 180);
    }

    // 1. Blender / Unity 3D glowing silhouette outline
    cx.save();
    cx.strokeStyle = '#2563eb';
    cx.lineWidth = 2.8 / zoom;
    cx.lineCap = 'round';
    cx.lineJoin = 'round';
    cx.shadowColor = '#3b82f6';
    cx.shadowBlur = 10 / zoom;
    if (cached.path) cx.stroke(cached.path);
    else { drawPathCommands(cx, cached.outline); cx.stroke(); }
    cx.restore();

    // 2. Wireframe facet illumination (Blender / Unity edge highlights)
    if (cached.decorations?.length) {
      cx.save();
      cx.strokeStyle = 'rgba(96, 165, 250, 0.9)';
      cx.lineWidth = 1.3 / zoom;
      cx.lineCap = 'round';
      cx.lineJoin = 'round';
      for (const commands of cached.decorations) {
        cx.beginPath();
        drawPathCommands(cx, commands);
        cx.stroke();
      }
      cx.restore();
    }

    // 3. 3D Bounding Cage / Corner Brackets (Blender / Unity 3D style)
    const pad = 6 / zoom;
    const bMinX = bounds.minX - pad, bMinY = bounds.minY - pad;
    const bMaxX = bounds.maxX + pad, bMaxY = bounds.maxY + pad;
    const bW = bMaxX - bMinX, bH = bMaxY - bMinY;

    // Subtle dashed bounding box
    cx.save();
    cx.strokeStyle = 'rgba(59, 130, 246, 0.45)';
    cx.lineWidth = 1 / zoom;
    cx.setLineDash([4 / zoom, 4 / zoom]);
    cx.strokeRect(bMinX, bMinY, bW, bH);
    cx.restore();

    // High-tech Corner Brackets
    const bracketLen = Math.min(14 / zoom, Math.min(bW, bH) * 0.28);
    cx.save();
    cx.strokeStyle = '#2563eb';
    cx.lineWidth = 2.2 / zoom;
    cx.lineCap = 'round';
    cx.lineJoin = 'round';

    // Top-Left corner
    cx.beginPath();
    cx.moveTo(bMinX, bMinY + bracketLen);
    cx.lineTo(bMinX, bMinY);
    cx.lineTo(bMinX + bracketLen, bMinY);
    cx.stroke();

    // Top-Right corner
    cx.beginPath();
    cx.moveTo(bMaxX - bracketLen, bMinY);
    cx.lineTo(bMaxX, bMinY);
    cx.lineTo(bMaxX, bMinY + bracketLen);
    cx.stroke();

    // Bottom-Right corner
    cx.beginPath();
    cx.moveTo(bMaxX, bMaxY - bracketLen);
    cx.lineTo(bMaxX, bMaxY);
    cx.lineTo(bMaxX - bracketLen, bMaxY);
    cx.stroke();

    // Bottom-Left corner
    cx.beginPath();
    cx.moveTo(bMinX + bracketLen, bMaxY);
    cx.lineTo(bMinX, bMaxY);
    cx.lineTo(bMinX, bMaxY - bracketLen);
    cx.stroke();

    // 4. Center Anchor / Pivot Indicator (Blender / Unity origin point)
    cx.beginPath();
    cx.arc(0, 0, 4 / zoom, 0, Math.PI * 2);
    cx.fillStyle = '#3b82f6';
    cx.fill();
    cx.strokeStyle = '#ffffff';
    cx.lineWidth = 1.5 / zoom;
    cx.stroke();

    cx.restore();

    // 5. If single selection, also draw interactive 3D rotation & scale controls
    if (this.sel.size === 1) {
      const basis = this.solidTransformBasis(shape);
      if (basis) this.drawSolidTransformControls(shape, basis);
    }
  }

  private saveH() {
    this.pendingFormulaCaptureId = null;
    this.undoManager.stopCapturing();
    while (this.undoManager.undoStack.length > 100) this.undoManager.undoStack.shift();
    while (this.undoManager.redoStack.length > 100) this.undoManager.redoStack.shift();
  }
}

// ─── pure helpers ─────────────────────────────────────────────────────────────
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPositionedShape(shape: AnyShape): shape is PositionedShape {
  return 'x' in shape && 'y' in shape && 'w' in shape && 'h' in shape;
}

function isDomOverlayShape(shape: AnyShape): shape is DomOverlayShape {
  return shape.type === 'sticky' || shape.type === 'math' || shape.type === 'code'
    || shape.type === 'text' || shape.type === 'image' || shape.type === 'video'
    || shape.type === 'link-card';
}

function isTextTool(value: string): value is 'text' | 'math' | 'code' {
  return value === 'text' || value === 'math' || value === 'code';
}

function isLegacyBoxToolType(value: string): value is LegacyBoxToolType {
  return value === 'rect' || value === 'rounded-rect' || value === 'ellipse' || value === 'triangle'
    || value === 'right-triangle' || value === 'diamond' || value === 'parallelogram'
    || value === 'trapezoid' || value === 'pentagon' || value === 'hexagon' || value === 'star';
}

interface LegacyBoxSeed {
  id: string;
  x: number;
  y: number;
  shapeId: string;
  params: Record<string, unknown>;
  fill: string;
  stroke: string;
  sw: number;
}

function createLegacyBoxShape(type: LegacyBoxToolType, seed: LegacyBoxSeed): AnyShape {
  const common = {
    ...seed, w: 0, h: 0, rotation: 0,
    minX: seed.x, minY: seed.y, maxX: seed.x, maxY: seed.y,
  };
  switch (type) {
    case 'rect': return { ...common, type: 'rect' };
    case 'rounded-rect': return { ...common, type: 'rounded-rect' };
    case 'ellipse': return { ...common, type: 'ellipse' };
    case 'triangle': return { ...common, type: 'triangle' };
    case 'diamond': return { ...common, type: 'diamond' };
    case 'star': return { ...common, type: 'star' };
    case 'right-triangle':
    case 'parallelogram':
    case 'trapezoid':
    case 'pentagon':
    case 'hexagon': return { ...common, type };
  }
}

function cloneShapeWithOffset(shape: AnyShape, id: string, offset: number, newIds: Map<string, string>, existingIds: ReadonlySet<string>): AnyShape {
  if (shape.type === 'pen') {
    const pts = shape.pts.map(point => [point[0] + offset, point[1] + offset, point[2]]);
    return withComputedShapeBounds({ ...shape, id, pts });
  }
  if (shape.type === 'curve') {
    const pts = shape.pts.map(point => [point[0] + offset, point[1] + offset, point[2]]);
    return withComputedShapeBounds({ ...shape, id, pts });
  }
  if (shape.type === 'line') {
    return withComputedShapeBounds({ ...shape, id, x1: shape.x1 + offset, y1: shape.y1 + offset,
      x2: shape.x2 + offset, y2: shape.y2 + offset });
  }
  if (shape.type === 'arrow') {
    return withComputedShapeBounds({ ...shape, id, x1: shape.x1 + offset, y1: shape.y1 + offset,
      x2: shape.x2 + offset, y2: shape.y2 + offset });
  }
  if (shape.type === 'connector') {
    const remapRef = (side: EndpointSide) => {
      const reference = side === 'source' ? shape.sourceRef : shape.targetRef;
      if (!reference) return undefined;
      const mapped = newIds.get(reference.shapeId);
      if (mapped) return { ...reference, shapeId: mapped };
      // Valid external links are detached in the copy; already-broken IDs remain broken so the
      // validator can report them rather than disguising them as free coordinate endpoints.
      return existingIds.has(reference.shapeId) ? undefined : reference;
    };
    const sourceRef = remapRef('source'), targetRef = remapRef('target');
    const next: ConnectorShape = {
      ...shape, id, x1: shape.x1 + offset, y1: shape.y1 + offset,
      x2: shape.x2 + offset, y2: shape.y2 + offset,
      waypoints: shape.waypoints.map(([x, y]) => [x + offset, y + offset]),
      sourceRef, targetRef,
      sourceIntent: sourceRef ? shape.sourceIntent ?? 'attached' : 'free',
      targetIntent: targetRef ? shape.targetIntent ?? 'attached' : 'free',
      invalidEndpointRefs: { ...(shape.invalidEndpointRefs ?? {}) },
      ...(shape.containerId ? (newIds.has(shape.containerId) ? { containerId: newIds.get(shape.containerId)! }
        : existingIds.has(shape.containerId) ? { containerId: undefined } : {}) : {}),
    };
    return withComputedShapeBounds(next);
  }
  if (isPositionedShape(shape)) {
    const oldContainerId = 'containerId' in shape && typeof shape.containerId === 'string' ? shape.containerId : undefined;
    const containerId = oldContainerId
      ? newIds.get(oldContainerId) ?? (existingIds.has(oldContainerId) ? undefined : oldContainerId) : undefined;
    return withComputedShapeBounds({ ...shape, id, x: shape.x + offset, y: shape.y + offset,
      ...(containerId ? { containerId } : {}) } as AnyShape);
  }
  const unreachableShape: never = shape;
  return unreachableShape;
}

export function isBoxShapeTool(value: string): value is BoxShapeTool {
  return getShapeDefinitionByToolId(value)?.kind === 'shape';
}

export function isConnectorTool(value: string): value is ConnectorTool {
  return getShapeDefinitionByToolId(value)?.kind === 'connector';
}

export function isConnectorShape(shape: AnyShape): boolean {
  return shape.type === 'connector' || shape.type === 'line' || shape.type === 'arrow';
}

export function isLabelEditableShape(shape: AnyShape): boolean {
  if (['sticky', 'text', 'math', 'code'].includes(shape.type)) return true;
  if (shape.type === 'diagram') return Boolean(getShapeDefinition((shape as DiagramShape).shapeId));
  return isBoxShapeTool(shape.type) && 'x' in shape && 'w' in shape;
}

export { isDoubleClickTextEditableShape };

export function isFixedShapeLabel(shape: AnyShape): boolean {
  if (shape.type === 'diagram') return Boolean(getShapeDefinition((shape as DiagramShape).shapeId));
  return isBoxShapeTool(shape.type) && 'x' in shape && 'w' in shape;
}

function isConnectableShape(shape: AnyShape): boolean {
  if (shape.type === 'diagram') return Boolean(getShapeDefinition((shape as DiagramShape).shapeId));
  return isBoxShapeTool(shape.type) && !['image', 'text', 'math', 'code', 'sticky'].includes(shape.type) && 'x' in shape;
}

function isRotatableBox(shape: AnyShape): shape is RotatableShape {
  return 'x' in shape && 'y' in shape && 'w' in shape && 'h' in shape;
}

function localSolidProjectedBounds(shape: DiagramShape) {
  const definition = getShapeDefinition(shape.shapeId);
  if (!definition?.solid3d) return { minX: 0, minY: 0, maxX: shape.w, maxY: shape.h };
  const scale = shape.scale3d ?? definition.defaultScale3d ?? solid3DScaleFromBounds(shape.w, shape.h, definition.width, definition.height, definition.geometry as Solid3DGeometry);
  return buildShapeGeometry(definition, shape.w, shape.h, shape.params ?? definition.defaultParams ?? {}, {
    scale, referenceWidth: definition.width, referenceHeight: definition.height, center: { x: 0, y: 0 },
  }).projection?.projectedBounds ?? { minX: 0, minY: 0, maxX: shape.w, maxY: shape.h };
}

function projectedSolidWorldCorners(shape: DiagramShape): [number, number][] {
  const bounds = localSolidProjectedBounds(shape);
  return [[bounds.minX, bounds.minY], [bounds.maxX, bounds.minY], [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]].map(([x, y]) =>
    rotatePoint(shape.x + x, shape.y + y, shape.x, shape.y, shape.rotation ?? 0));
}

/** Ordinary 2D creation keeps its established aspect/free resize policy. */
function getShapeCreationResizePolicy(definition?: ShapeDefinition): ShapeResizePolicy {
  return definition?.solid3d ? { mode: 'free' } : getNotationResizePolicy(definition);
}

function getNotationResizePolicy(
  definition: ShapeDefinition | undefined,
  capabilities: ReturnType<typeof diagramCapabilitiesFor> = diagramCapabilitiesFor(definition),
): ShapeResizePolicy {
  const transform = capabilities.transform, legacyPolicy = getShapeResizePolicy(definition);
  if (transform.aspectLocked) return { mode: 'aspect', aspectRatio: Number.isFinite(transform.aspectRatio) && (transform.aspectRatio ?? 0) > 0
    ? transform.aspectRatio! : legacyPolicy.mode === 'aspect' ? legacyPolicy.aspectRatio : 1 };
  if (transform.resizeX === false && transform.resizeY !== false) return { mode: 'vertical' };
  if (transform.resizeY === false && transform.resizeX !== false) return { mode: 'horizontal' };
  return legacyPolicy;
}

function getNotationResizeHandles(box: BoxShape, capabilities: ReturnType<typeof diagramCapabilitiesFor>): [string, number, number][] {
  const transform = capabilities.transform;
  if (transform.resize === false || transform.fixedSize) return [];
  const definition = box.type === 'diagram' && box.shapeId ? getShapeDefinition(box.shapeId) : undefined;
  const sequenceParticipant = definition?.semantic?.family === 'uml.sequence-participant';
  return getBoxHandlePoints(box).filter(([handle]) => {
    // Keep the participant head as its temporal origin: Sequence lifelines resize from the bottom,
    // never by moving their header with a north-side handle (notably create-message occurrences).
    if (sequenceParticipant && ['n', 'nw', 'ne'].includes(handle)) return false;
    const hasHorizontalAxis = handle.includes('e') || handle.includes('w');
    const hasVerticalAxis = handle.includes('n') || handle.includes('s');
    if (transform.resizeX === false && hasHorizontalAxis) return false;
    if (transform.resizeY === false && hasVerticalAxis) return false;
    return true;
  });
}

function withComputedShapeBounds<T extends AnyShape>(shape: T): T {
  if (shape.type === 'connector') return { ...shape, ...connectorBounds(shape as ConnectorShape) } as T;
  if (shape.type === 'diagram') {
    const diagram = shape as DiagramShape, definition = getShapeDefinition(diagram.shapeId);
    if (definition?.solid3d) {
      const geometry = definition.geometry as Solid3DGeometry;
      const params = { ...(definition.defaultParams ?? {}), ...(diagram.params ?? {}) };
      const normalized = { ...diagram, params, scale3d: normalizeSolid3DScale(geometry,
        diagram.scale3d ?? definition.defaultScale3d ?? solid3DScaleFromBounds(diagram.w, diagram.h,
          definition.width, definition.height, geometry)) };
      const corners = projectedSolidWorldCorners(normalized), xs = corners.map(point => point[0]), ys = corners.map(point => point[1]);
      return { ...normalized, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } as T;
    }
  }
  if (isRotatableBox(shape)) return { ...shape, ...rotatedBoxBounds(shape) } as T;
  return shape;
}

function getBoxHandlePoints(box: BoxShape): [string, number, number][] {
  const corners = rotatedBoxCorners(box);
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const points: [string, number, number][] = [
    ['nw', ...corners[0]], ['n', ...mid(corners[0], corners[1])], ['ne', ...corners[1]],
    ['e', ...mid(corners[1], corners[2])], ['se', ...corners[2]], ['s', ...mid(corners[2], corners[3])],
    ['sw', ...corners[3]], ['w', ...mid(corners[3], corners[0])],
  ];
  return points;
}

function getRotationHandlePoint(box: BoxShape, zoom: number): [number, number] {
  const point = objectPointToWorld(box, { x: box.w / 2, y: -24 / Math.max(0.04, zoom) });
  return [point.x, point.y];
}

/** Public route wrapper; Canvas interaction and picker previews share one route builder. */
export function getConnectorRoute(connector: ConnectorShape): [number, number][] {
  const definition = getShapeDefinition(connector.shapeId);
  const sameOwner = Boolean(connector.sequenceEvent?.selfCall
    || (connector.sequenceEvent?.sourceParticipantId && connector.sequenceEvent.sourceParticipantId === connector.sequenceEvent.targetParticipantId)
    || (connector.sourceRef && connector.targetRef && connector.sourceRef.shapeId === connector.targetRef.shapeId));
  const selfLoopKind = sameOwner && definition?.semantic?.family === 'uml.sequence-edge' ? 'sequence'
    : sameOwner && (definition?.semantic?.family === 'uml.activity-edge' || definition?.semantic?.family === 'uml.state-edge') ? 'behavioral' : undefined;
  const isSequenceEdge = definition?.semantic?.family === 'uml.sequence-edge';
  const isUmlRelationship = definition?.semantic?.family === 'uml.relationship-edge'
    || definition?.semantic?.family === 'uml.usecase-dependency';
  return buildConnectorRoute({ routeKind: definition?.routeKind, x1: connector.x1, y1: connector.y1,
    x2: connector.x2, y2: connector.y2, waypoints: connector.waypoints, parallelLane: connector.parallelLane,
    ...(isSequenceEdge ? { parallelLaneSpacing: UML_SEQUENCE_LANE_SPACING }
      : isUmlRelationship ? { parallelLaneSpacing: UML_RELATIONSHIP_LANE_SPACING } : {}),
    selfLoopKind, selfLoopSide: connector.sourceRef?.pointId });
}

/** Only non-collinear routes need a whole-path rotation handle; straight slopes are endpoint-edited. */
function hasConnectorRotationHandle(connector: ConnectorShape): boolean {
  const route = getConnectorRoute(connector);
  if (route.length < 3) return false;
  const [startX, startY] = route[0], [endX, endY] = route[route.length - 1];
  return route.slice(1, -1).some(([x, y]) => Math.abs((x - startX) * (endY - startY) - (y - startY) * (endX - startX)) > 1e-6);
}

function drawEndpointMarkerAt(ctx: CanvasRenderingContext2D, marker: 'bar', x: number, y: number, angle: number, size: number) {
  const nx = -Math.sin(angle), ny = Math.cos(angle);
  ctx.beginPath(); ctx.moveTo(x + nx * size * 0.45, y + ny * size * 0.45); ctx.lineTo(x - nx * size * 0.45, y - ny * size * 0.45); ctx.stroke();
  void marker;
}

function drawCrowFoot(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) {
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
  const baseX = x - ux * size * 0.55, baseY = y - uy * size * 0.55, half = size * 0.48;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(baseX + nx * half, baseY + ny * half);
  ctx.moveTo(x, y); ctx.lineTo(baseX, baseY); ctx.moveTo(x, y); ctx.lineTo(baseX - nx * half, baseY - ny * half); ctx.stroke();
}

function drawCardinalityMarker(ctx: CanvasRenderingContext2D, cardinality: string, x: number, y: number, angle: number, size: number, color: string) {
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 1.5;
  if (cardinality === 'many' || cardinality === 'one-or-many' || cardinality === 'zero-or-many') drawCrowFoot(ctx, x, y, angle, size);
  if (cardinality === 'one') {
    drawEndpointMarkerAt(ctx, 'bar', x, y, angle, size * 0.75);
    drawEndpointMarkerAt(ctx, 'bar', x - ux * size * 0.45, y - uy * size * 0.45, angle, size * 0.75);
  } else if (cardinality === 'one-or-many') {
    drawEndpointMarkerAt(ctx, 'bar', x - ux * size * 0.7, y - uy * size * 0.7, angle, size * 0.75);
  }
  if (cardinality === 'zero-or-one' || cardinality === 'zero-or-many') {
    const offset = cardinality === 'zero-or-one' ? size * 0.45 : size * 0.85;
    ctx.beginPath(); ctx.arc(x - ux * offset, y - uy * offset, size * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (cardinality === 'zero-or-one') drawEndpointMarkerAt(ctx, 'bar', x - ux * size * 1.05, y - uy * size * 1.05, angle, size * 0.75);
  }
  void nx; void ny;
  ctx.restore();
}

function withoutRepeatedClosingVertex(points: [number, number][]): [number, number][] {
  const first = points[0], last = points.at(-1);
  if (points.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) return points.slice(0, -1);
  return points;
}

/** World-space polygon used by polygon primitives and their hit/erase geometry. */
export function getShapeVertices(shape: AnyShape, applyRotation = true): [number, number][] {
  if (!('x' in shape && 'w' in shape && 'h' in shape)) return [];
  const box = shape as BoxShape, [x, y, w, h] = nr(box.x, box.y, box.w, box.h);
  const centerX = x + w / 2, centerY = y + h / 2;
  if (shape.type === 'diagram') {
    const definition = getShapeDefinition((shape as DiagramShape).shapeId);
    if (!definition || ['actor', 'umlRole', 'umlDestroy', 'annotation', 'umlLifeline'].includes(definition.geometry)) return [];
    const diagram = shape as DiagramShape;
    const solidOptions = definition.solid3d ? { scale: diagram.scale3d ?? definition.defaultScale3d ?? solid3DScaleFromBounds(w, h, definition.width, definition.height, definition.geometry as Solid3DGeometry),
      referenceWidth: definition.width, referenceHeight: definition.height } : undefined;
    return withoutRepeatedClosingVertex(flattenFirstPath(buildGeometryCommands(definition.geometry, w, h, diagram.params, solidOptions), 8))
      .map(([px, py]) => applyRotation ? rotatePoint(x + px, y + py, centerX, centerY, box.rotation ?? 0) : [x + px, y + py]);
  }
  let vertices: [number, number][] = [];
  if (box.vertices && box.vertices.length >= 3) {
    vertices = box.vertices.map(([nx, ny]) => [x + nx * w, y + ny * h]);
  } else if (getShapeDefinitionForLegacyType(shape.type)?.kind === 'shape') {
    const definition = getShapeDefinitionForLegacyType(shape.type)!;
    vertices = withoutRepeatedClosingVertex(flattenFirstPath(buildGeometryCommands(definition.geometry, w, h,
      { ...(definition.defaultParams ?? {}), ...(box.params ?? {}) }), 12)).map(([px, py]) => [x + px, y + py]);
  } else {
    const left = x, right = x + w, top = y, bottom = y + h;
    const corners: Record<string, [number, number][]> = {
      rect: [[left, top], [right, top], [right, bottom], [left, bottom]],
      'rounded-rect': [[left, top], [right, top], [right, bottom], [left, bottom]],
      triangle: [[centerX, top], [right, bottom], [left, bottom]],
      'right-triangle': [[left, top], [right, bottom], [left, bottom]],
      diamond: [[centerX, top], [right, centerY], [centerX, bottom], [left, centerY]],
      parallelogram: [[left + w * 0.24, top], [right, top], [right - w * 0.24, bottom], [left, bottom]],
      trapezoid: [[left + w * 0.22, top], [right - w * 0.22, top], [right, bottom], [left, bottom]],
      callout: [[left, top], [right, top], [right, bottom], [left + w * 0.30, bottom], [left + w * 0.20, bottom + 20], [left + w * 0.22, bottom], [left, bottom]],
    };
    if (corners[shape.type]) vertices = corners[shape.type];
    else if (shape.type === 'ellipse') vertices = Array.from({ length: 48 }, (_, index): [number, number] => {
      const angle = index / 48 * Math.PI * 2;
      return [centerX + Math.cos(angle) * w / 2, centerY + Math.sin(angle) * h / 2];
    });
    else if (shape.type === 'star') {
      const points = Math.max(3, Math.round(Number(box.params?.points) || 5));
      const inner = Math.max(0.12, Math.min(0.88, Number(box.params?.innerRatio) || 0.42));
      vertices = Array.from({ length: points * 2 }, (_, index): [number, number] => {
        const radius = index % 2 ? inner : 1, angle = index * Math.PI / points - Math.PI / 2;
        return [centerX + Math.cos(angle) * w / 2 * radius, centerY + Math.sin(angle) * h / 2 * radius];
      });
    } else if (shape.type === 'pentagon' || shape.type === 'hexagon') {
      const sides = shape.type === 'pentagon' ? 5 : 6;
      vertices = Array.from({ length: sides }, (_, index): [number, number] => {
        const angle = index / sides * Math.PI * 2 - Math.PI / 2;
        return [centerX + Math.cos(angle) * w / 2, centerY + Math.sin(angle) * h / 2];
      });
    }
  }
  return vertices.map(([px, py]) => applyRotation ? rotatePoint(px, py, centerX, centerY, box.rotation ?? 0) : [px, py]);
}

function getDiagramPathGroups(shape: DiagramShape): { outlines: [number, number][][]; decorations: [number, number][][]; intrinsicFills: [number, number][][] } {
  const definition = getShapeDefinition(shape.shapeId);
  if (!definition) return { outlines: [], decorations: [], intrinsicFills: [] };
  const geometry = buildShapeGeometry(definition, shape.w, shape.h, shape.params, definition.solid3d ? {
    scale: shape.scale3d ?? definition.defaultScale3d ?? solid3DScaleFromBounds(shape.w, shape.h, definition.width, definition.height, definition.geometry as Solid3DGeometry),
    referenceWidth: definition.width, referenceHeight: definition.height, center: { x: 0, y: 0 },
  } : undefined);
  const localOutlines = flattenCommandPaths(geometry.outline, 10);
  const localDecorations = [...geometry.decorations, ...geometry.hiddenEdges].flatMap(commands => flattenCommandPaths(commands, 10));
  const localIntrinsicFills = geometry.intrinsicFills.flatMap(commands => flattenCommandPaths(commands, 10));
  const solidOrigin = Boolean(definition.solid3d);
  const cx = solidOrigin ? shape.x : shape.x + shape.w / 2;
  const cy = solidOrigin ? shape.y : shape.y + shape.h / 2;
  const transform = (paths: [number, number][][]) => paths.map(path => path.map(([x, y]) =>
    rotatePoint(shape.x + x, shape.y + y, cx, cy, shape.rotation ?? 0)));
  return { outlines: transform(localOutlines), decorations: transform(localDecorations), intrinsicFills: transform(localIntrinsicFills) };
}

function pointTouchesDiagram(shape: DiagramShape, point: { x: number; y: number }, tolerance: number): boolean {
  const definition = getShapeDefinition(shape.shapeId);
  if (!definition) return false;
  const { outlines, decorations, intrinsicFills } = getDiagramPathGroups(shape);
  if (definition.geometry === 'actor' && Boolean(shape.text?.trim())) {
    const centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
    const [localX, localY] = unrotatePoint(point.x, point.y, centerX, centerY, shape.rotation ?? 0);
    const x = localX - shape.x, y = localY - shape.y;
    if (x >= 0 && x <= shape.w && y >= shape.h * 0.76 && y <= shape.h) return true;
  }
  if (definition.geometry === 'annotation' || definition.geometry === 'umlLifeline' || definition.geometry === 'umlActorParticipant' || definition.geometry === 'umlRole') {
    const centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
    const [localX, localY] = unrotatePoint(point.x, point.y, centerX, centerY, shape.rotation ?? 0);
    const x = localX - shape.x, y = localY - shape.y;
    if (definition.geometry === 'annotation') return x >= 0 && x <= shape.w && y >= 0 && y <= shape.h;
    const headerHeight = Math.min(shape.h, sequenceParticipantHeaderHeight(definition.geometry));
    if (x >= 0 && x <= shape.w && y >= 0 && y <= headerHeight) return true;
    const stemHitWidth = Math.max(32, shape.w * 0.45);
    if (Math.abs(x - shape.w / 2) <= stemHitWidth / 2 && y >= headerHeight && y <= shape.h) return true;
  }
  if (geometryUsesFill(definition.geometry) && outlines.some(path => path.length >= 3 && pointInsidePolygon(point, path))) return true;
  if (intrinsicFills.some(path => path.length >= 3 && pointInsidePolygon(point, path))) return true;
  const paths = [...outlines, ...decorations], threshold = tolerance + Math.max(0, shape.sw) / 2;
  return paths.some(path => path.slice(1).some((sample, index) => pointToSegmentDistance(point,
    { x: path[index][0], y: path[index][1] }, { x: sample[0], y: sample[1] }) <= threshold));
}

function segmentTouchesDiagram(shape: DiagramShape, from: { x: number; y: number }, to: { x: number; y: number }, radius: number): boolean {
  const definition = getShapeDefinition(shape.shapeId);
  if (!definition) return false;
  const { outlines, decorations, intrinsicFills } = getDiagramPathGroups(shape), strokeRadius = radius + Math.max(0, shape.sw) / 2;
  const filled = geometryUsesFill(definition.geometry) && fillIsVisible(shape.fill);
  if (definition.geometry === 'actor' && Boolean(shape.text?.trim())) {
    const centerX = shape.x + shape.w / 2, centerY = shape.y + shape.h / 2;
    const band = [[shape.x, shape.y + shape.h * 0.76], [shape.x + shape.w, shape.y + shape.h * 0.76],
      [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]].map(([x, y]) =>
      rotatePoint(x, y, centerX, centerY, shape.rotation ?? 0) as [number, number]);
    if (segmentTouchesPolygon(from, to, band, strokeRadius, true)) return true;
  }
  for (const path of outlines) if (segmentTouchesPolygon(from, to, path, strokeRadius, filled)) return true;
  for (const path of intrinsicFills) if (segmentTouchesPolygon(from, to, path, strokeRadius, true)) return true;
  for (const path of decorations) {
    for (let index = 1; index < path.length; index++) {
      if (segmentDistance(from, to, { x: path[index - 1][0], y: path[index - 1][1] }, { x: path[index][0], y: path[index][1] }) <= strokeRadius) return true;
    }
  }
  return false;
}

function flattenCommandPaths(commands: readonly PathCommand[], steps = 8): [number, number][][] {
  const paths: [number, number][][] = [];
  let points: [number, number][] = [], current: [number, number] = [0, 0], start: [number, number] = [0, 0];
  const finish = () => { if (points.length) paths.push(points); points = []; };
  for (const item of commands) {
    const [a, b, c, d, e, f, g, h] = item.values;
    if (item.op === 'moveTo') {
      finish(); current = [a, b]; start = current; points.push(current);
    } else if (item.op === 'lineTo') {
      current = [a, b]; points.push(current);
    } else if (item.op === 'quadraticCurveTo') {
      const from = current;
      for (let index = 1; index <= steps; index++) {
        const t = index / steps, u = 1 - t;
        points.push([u * u * from[0] + 2 * u * t * a + t * t * c, u * u * from[1] + 2 * u * t * b + t * t * d]);
      }
      current = [c, d];
    } else if (item.op === 'bezierCurveTo') {
      const from = current;
      for (let index = 1; index <= steps; index++) {
        const t = index / steps, u = 1 - t;
        points.push([u ** 3 * from[0] + 3 * u * u * t * a + 3 * u * t * t * c + t ** 3 * e,
          u ** 3 * from[1] + 3 * u * u * t * b + 3 * u * t * t * d + t ** 3 * f]);
      }
      current = [e, f];
    } else if (item.op === 'ellipse') {
      const cx = a, cy = b, rx = c, ry = d, rotation = e, startAngle = f, endAngle = g, anti = Boolean(h);
      let sweep = endAngle - startAngle;
      if (anti && sweep > 0) sweep -= Math.PI * 2;
      if (!anti && sweep < 0) sweep += Math.PI * 2;
      const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI * 2) * steps * 4));
      const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
      for (let index = 1; index <= count; index++) {
        const angle = startAngle + sweep * index / count;
        points.push([cx + rx * Math.cos(angle) * cosR - ry * Math.sin(angle) * sinR,
          cy + rx * Math.cos(angle) * sinR + ry * Math.sin(angle) * cosR]);
      }
      current = points.at(-1) ?? current;
    } else if (item.op === 'closePath') {
      if (points.length && (points.at(-1)![0] !== start[0] || points.at(-1)![1] !== start[1])) points.push(start);
      current = start;
    }
  }
  finish();
  return paths;
}

function flattenFirstPath(commands: readonly PathCommand[], steps = 8): [number, number][] {
  return flattenCommandPaths(commands, steps)[0] ?? [];
}

function pointToSegmentDistance(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function orientation2d(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function lineSegmentsCross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const abC = orientation2d(a, b, c), abD = orientation2d(a, b, d);
  const cdA = orientation2d(c, d, a), cdB = orientation2d(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function segmentDistance(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): number {
  if (lineSegmentsCross(a, b, c, d)) return 0;
  return Math.min(pointToSegmentDistance(a, c, d), pointToSegmentDistance(b, c, d), pointToSegmentDistance(c, a, b), pointToSegmentDistance(d, a, b));
}

function pointInsidePolygon(point: { x: number; y: number }, vertices: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i], [xj, yj] = vertices[j];
    if ((yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function isClosedPath(points: readonly [number, number][]): boolean {
  return points.length >= 4 && Math.hypot(points[0][0] - points.at(-1)![0], points[0][1] - points.at(-1)![1]) <= 1e-6;
}

function shapeStrokeWidth(shape: AnyShape): number {
  return 'sw' in shape && typeof shape.sw === 'number' ? Math.max(0, shape.sw) : 0;
}

function lassoTouchesArea(lasso: [number, number][], region: [number, number][], radius = 0): boolean {
  if (lasso.length < 3 || region.length < 3) return lassoTouchesPolyline(lasso, region, radius);
  if (lasso.some(([x, y]) => pointInsidePolygon({ x, y }, region))
    || region.some(([x, y]) => pointInsidePolygon({ x, y }, lasso))) return true;
  for (let index = 0; index < lasso.length; index++) {
    const a = lasso[index], b = lasso[(index + 1) % lasso.length];
    for (let regionIndex = 0; regionIndex < region.length; regionIndex++) {
      const c = region[regionIndex], d = region[(regionIndex + 1) % region.length];
      if (segmentDistance({ x: a[0], y: a[1] }, { x: b[0], y: b[1] },
        { x: c[0], y: c[1] }, { x: d[0], y: d[1] }) <= radius) return true;
    }
  }
  return false;
}

function lassoTouchesPolyline(lasso: [number, number][], line: [number, number][], radius: number): boolean {
  if (lasso.length < 3 || !line.length) return false;
  if (line.some(([x, y]) => pointInsidePolygon({ x, y }, lasso))) return true;
  const lineSegments: Array<[[number, number], [number, number]]> = line.length === 1
    ? [[line[0], line[0]]]
    : line.slice(1).map((point, index) => [line[index], point]);
  for (const [a, b] of lineSegments) for (let index = 0; index < lasso.length; index++) {
    const c = lasso[index], d = lasso[(index + 1) % lasso.length];
    if (segmentDistance({ x: a[0], y: a[1] }, { x: b[0], y: b[1] },
      { x: c[0], y: c[1] }, { x: d[0], y: d[1] }) <= radius) return true;
  }
  return false;
}

function circlePolygon(center: [number, number], radius: number, segments = 24): [number, number][] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = index * Math.PI * 2 / segments;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
  });
}

function legacyArrowHeadPolygon(arrow: ArrowShape): [number, number][] {
  const angle = Math.atan2(arrow.y2 - arrow.y1, arrow.x2 - arrow.x1), length = 10 + arrow.sw * 3;
  return [[arrow.x2, arrow.y2],
    [arrow.x2 - length * Math.cos(angle - 0.42), arrow.y2 - length * Math.sin(angle - 0.42)],
    [arrow.x2 - length * Math.cos(angle + 0.42), arrow.y2 - length * Math.sin(angle + 0.42)]];
}

function connectorMarkerPaths(marker: EndpointMarker | undefined, point: [number, number], neighbor: [number, number], size: number): [number, number][][] {
  if (!marker || marker === 'none') return [];
  const dx = point[0] - neighbor[0], dy = point[1] - neighbor[1], length = Math.max(1e-6, Math.hypot(dx, dy));
  const ux = dx / length, uy = dy / length, nx = -uy, ny = ux;
  const base = (distance: number, side: number): [number, number] => [point[0] - ux * distance + nx * size * side,
    point[1] - uy * distance + ny * size * side];
  const closed = (points: [number, number][]) => [...points, points[0]];
  const line = (a: [number, number], b: [number, number]) => [a, b];
  const triangle = closed([point, base(size * 1.55, 0.58), base(size * 1.55, -0.58)]);
  const diamond = closed([point, base(size * 0.85, 0.72), base(size * 1.7, 0), base(size * 0.85, -0.72)]);
  if (marker === 'arrow' || marker === 'blockArrow') return [triangle];
  if (marker === 'openArrow') return [line(base(size * 1.55, 0.6), point), line(point, base(size * 1.55, -0.6))];
  if (marker === 'hollowTriangle') return [triangle];
  if (marker === 'diamond' || marker === 'filledDiamond') return [diamond];
  if (marker === 'circle' || marker === 'filledCircle' || marker === 'zeroOrOne') return [circlePolygon([point[0] - ux * size * 0.5, point[1] - uy * size * 0.5], size * 0.35)];
  if (marker === 'bar') return [line([point[0] + nx * size * 0.45, point[1] + ny * size * 0.45],
    [point[0] - nx * size * 0.45, point[1] - ny * size * 0.45])];
  if (marker === 'crowFoot') return [line(point, base(size * 1.6, 0.62)), line(point, base(size * 1.6, 0)), line(point, base(size * 1.6, -0.62))];
  // One/many cardinality endpoint glyphs are compound; a conservative envelope encloses all their strokes.
  return [circlePolygon(point, size * 1.2)];
}

function segmentTouchesPolygon(
  from: { x: number; y: number },
  to: { x: number; y: number },
  vertices: [number, number][],
  radius: number,
  filled: boolean,
): boolean {
  if (vertices.length < 3) return false;
  if (filled && (pointInsidePolygon(from, vertices) || pointInsidePolygon(to, vertices))) return true;
  for (let index = 0; index < vertices.length; index++) {
    const [x1, y1] = vertices[index], [x2, y2] = vertices[(index + 1) % vertices.length];
    if (segmentDistance(from, to, { x: x1, y: y1 }, { x: x2, y: y2 }) <= radius) return true;
  }
  return false;
}

function fillIsVisible(fill: string | undefined): boolean {
  if (!fill || fill === 'transparent' || fill === 'none') return false;
  const rgba = fill.match(/^rgba?\([^)]*,\s*([\d.]+)\s*\)$/i);
  return !rgba || Number(rgba[1]) > 0;
}

function eraserSegmentTouchesShape(
  shape: AnyShape,
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
): boolean {
  if (shape.type === 'pen') {
    const pen = shape as PenShape;
    const threshold = radius + Math.max(0, pen.size) / 2;
    if (pen.pts.length === 1) return Math.hypot(from.x - pen.pts[0][0], from.y - pen.pts[0][1]) <= threshold;
    for (let index = 1; index < pen.pts.length; index++) {
      const [x1, y1] = pen.pts[index - 1], [x2, y2] = pen.pts[index];
      if (segmentDistance(from, to, { x: x1, y: y1 }, { x: x2, y: y2 }) <= threshold) return true;
    }
    return false;
  }
  if (shape.type === 'line') {
    const line = shape as LineShape;
    return segmentDistance(from, to, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }) <= radius + line.sw / 2;
  }
  if (shape.type === 'curve') {
    const curve = shape as CurveShape;
    const threshold = radius + curve.sw / 2;
    if (curve.pts.length === 1) return segmentDistance(from, to,
      { x: curve.pts[0][0], y: curve.pts[0][1] }, { x: curve.pts[0][0], y: curve.pts[0][1] }) <= threshold;
    for (let index = 1; index < curve.pts.length; index++) {
      const previous = curve.pts[index - 1], current = curve.pts[index];
      if (segmentDistance(from, to, { x: previous[0], y: previous[1] }, { x: current[0], y: current[1] }) <= threshold) return true;
    }
    return false;
  }
  if (shape.type === 'connector') {
    const connector = shape as ConnectorShape, route = getConnectorRoute(connector), threshold = radius + connector.sw / 2;
    if (route.slice(1).some((point, index) => segmentDistance(from, to,
      { x: route[index][0], y: route[index][1] }, { x: point[0], y: point[1] }) <= threshold)) return true;
    if (connector.label?.trim()) {
      const middle = route[Math.floor(route.length / 2)] ?? [connector.x1, connector.y1];
      const labelWidth = Math.min(280, connector.label.trim().slice(0, 512).length * 8.4) + 8;
      const labelHeight = 18;
      const plate: [number, number][] = [[middle[0] - labelWidth / 2, middle[1] - labelHeight / 2],
        [middle[0] + labelWidth / 2, middle[1] - labelHeight / 2],
        [middle[0] + labelWidth / 2, middle[1] + labelHeight / 2],
        [middle[0] - labelWidth / 2, middle[1] + labelHeight / 2]];
      return segmentTouchesPolygon(from, to, plate, radius, true);
    }
    return false;
  }
  if (shape.type === 'arrow') {
    const arrow = shape as ArrowShape;
    const width = radius + arrow.sw / 2;
    if (segmentDistance(from, to, { x: arrow.x1, y: arrow.y1 }, { x: arrow.x2, y: arrow.y2 }) <= width) return true;
    const angle = Math.atan2(arrow.y2 - arrow.y1, arrow.x2 - arrow.x1), headLength = 10 + arrow.sw * 3;
    const head: [number, number][] = [
      [arrow.x2, arrow.y2],
      [arrow.x2 - headLength * Math.cos(angle - 0.42), arrow.y2 - headLength * Math.sin(angle - 0.42)],
      [arrow.x2 - headLength * Math.cos(angle + 0.42), arrow.y2 - headLength * Math.sin(angle + 0.42)],
    ];
    return segmentTouchesPolygon(from, to, head, radius, true);
  }
  if (shape.type === 'diagram') return segmentTouchesDiagram(shape as DiagramShape, from, to, radius);
  if (isBoxShapeTool(shape.type)) {
    const vertices = getShapeVertices(shape);
    const fill = 'fill' in shape ? shape.fill : undefined;
    const strokeWidth = 'sw' in shape ? shape.sw : 0;
    return segmentTouchesPolygon(from, to, vertices, radius + strokeWidth / 2, fillIsVisible(fill));
  }
  if ('x' in shape && 'w' in shape && 'h' in shape) {
    const box = shape as BoxShape;
    const vertices: [number, number][] = [
      [box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h],
    ];
    // Text-like, sticky, image, and formula objects use their existing rectangular hit area.
    return segmentTouchesPolygon(from, to, vertices, radius, true);
  }
  return false;
}

export { normalizeDragBox };

const STICKY_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STICKY_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatStickyTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayOfWeek = STICKY_DAYS[date.getDay()];
  const d = pad(date.getDate());
  const monthName = STICKY_MONTHS[date.getMonth()];
  const y = date.getFullYear();
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${dayOfWeek}, ${d} ${monthName} ${y} - ${h}:${min}:${s}`;
}

function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

function nr(x:number,y:number,w:number,h:number):[number,number,number,number]{
  return [w<0?x+w:x, h<0?y+h:y, Math.abs(w), Math.abs(h)];
}

function getXY(s: AnyShape): {x:number,y:number} {
  if (isPositionedShape(s)) return { x: s.x, y: s.y };
  if (s.type==='line' || s.type==='arrow' || s.type==='connector') return {x:(s as LineShape | ArrowShape | ConnectorShape).x1, y:(s as LineShape | ArrowShape | ConnectorShape).y1};
  return {x:s.minX, y:s.minY};
}

function moveShape(s: AnyShape, nx: number, ny: number): AnyShape {
  if (s.type==='pen') {
    const p=s as PenShape; const dx=nx-p.minX, dy=ny-p.minY;
    return {...p, pts:p.pts.map(q=>[q[0]+dx,q[1]+dy,q[2]]), minX:nx, minY:ny, maxX:p.maxX+dx, maxY:p.maxY+dy};
  }
  if (s.type==='line') {
    const line=s as LineShape; const dx=nx-line.x1, dy=ny-line.y1;
    return {...line, x1:nx, y1:ny, x2:line.x2+dx, y2:line.y2+dy,
      minX:Math.min(nx,line.x2+dx), minY:Math.min(ny,line.y2+dy),
      maxX:Math.max(nx,line.x2+dx), maxY:Math.max(ny,line.y2+dy)};
  }
  if (s.type==='curve') {
    const curve=s as CurveShape; const dx=nx-curve.minX, dy=ny-curve.minY;
    return {...curve, pts:curve.pts.map(point=>[point[0]+dx,point[1]+dy,point[2]]),
      minX:nx, minY:ny, maxX:curve.maxX+dx, maxY:curve.maxY+dy};
  }
  if (s.type==='arrow') {
    const a=s as ArrowShape; const dx=nx-a.x1, dy=ny-a.y1;
    return {...a, x1:nx,y1:ny,x2:a.x2+dx,y2:a.y2+dy, minX:Math.min(nx,a.x2+dx),minY:Math.min(ny,a.y2+dy),maxX:Math.max(nx,a.x2+dx),maxY:Math.max(ny,a.y2+dy)};
  }
  if (s.type==='connector') {
    const connector=s as ConnectorShape; const dx=nx-connector.x1, dy=ny-connector.y1;
    // Whole-connector movement translates free ends and waypoints while snapped endpoints remain
    // owned by their semantic nodes. Endpoint handles use the separate reconnect path.
    const next={...connector,
      x1:connector.sourceRef ? connector.x1 : nx,
      y1:connector.sourceRef ? connector.y1 : ny,
      x2:connector.targetRef ? connector.x2 : connector.x2+dx,
      y2:connector.targetRef ? connector.y2 : connector.y2+dy,
      waypoints:connector.waypoints.map(([x,y])=>[x+dx,y+dy] as [number,number]),
    };
    return {...next,...connectorBounds(next)};
  }
  if (isPositionedShape(s)) return withComputedShapeBounds({ ...s, x: nx, y: ny });
  return s;
}


