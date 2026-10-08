import type {
  ShapeDataCapability,
  ShapeDefinition,
  ShapeParameterControl,
  ShapeParameterMetadata,
  ShapeParameterOption,
} from './types';

type ParameterSchema = {
  readonly label: string;
  readonly description: string;
  readonly control?: ShapeParameterControl;
  readonly previewImpact: ShapeParameterMetadata['previewImpact'];
};

const options = (...items: Array<[string, string]>): readonly ShapeParameterOption[] => items.map(([value, label]) => ({ value, label }));
const range = (min: number, max: number, step: number, unit?: string, precision?: number): ShapeParameterControl => ({
  type: 'range', min, max, step, ...(unit ? { unit } : {}), ...(precision !== undefined ? { precision } : {}),
});

/**
 * One reusable capability catalogue for all native shape parameters. A control exists only
 * for intentionally user-editable values. Unknown keys are internal by default, rather than
 * accidentally becoming UI merely because they were serialized into a definition.
 */
export const SHAPE_PARAMETER_SCHEMA: Readonly<Record<string, ParameterSchema>> = Object.freeze({
  cornerRadiusRatio: { label: 'Corner radius', description: 'Proportional corner radius; width and height remain independent.', control: range(0.05, 0.4, 0.01, undefined, 2), previewImpact: 'geometry' },
  skew: { label: 'Skew', description: 'Horizontal slant ratio for the parallelogram sides.', control: range(0, 0.46, 0.01, undefined, 2), previewImpact: 'geometry' },
  topRatio: { label: 'Top width ratio', description: 'Top width as a fraction of the base width.', control: range(0.18, 1, 0.01, undefined, 2), previewImpact: 'geometry' },
  tailPosition: { label: 'Tail position', description: 'Horizontal position of the callout pointer along the body.', control: range(0.1, 0.8, 0.01, undefined, 2), previewImpact: 'geometry' },
  sides: { label: 'Sides', description: 'Number of sides in the regular polygon or prism/pyramid base.', control: range(3, 32, 1, undefined, 0), previewImpact: 'geometry' },
  heightRatio: { label: 'Height ratio', description: 'Length of the +Z perpendicular leg relative to either unit XY base leg; all three legs meet pairwise at a right-angle vertex.', control: range(0.2, 2, 0.01, undefined, 2), previewImpact: 'geometry' },
  points: { label: 'Star points', description: 'Number of outer points in the star.', control: range(3, 24, 1, undefined, 0), previewImpact: 'geometry' },
  innerRatio: { label: 'Inner radius', description: 'Inner-to-outer radius ratio for the star.', control: range(0.12, 0.88, 0.01, undefined, 2), previewImpact: 'geometry' },
  armRatio: { label: 'Arm width', description: 'Relative width of the cross arms.', control: range(0.16, 0.72, 0.01, undefined, 2), previewImpact: 'geometry' },
  shaftRatio: { label: 'Shaft height', description: 'Relative height of a block-arrow shaft.', control: range(0.16, 0.72, 0.01, undefined, 2), previewImpact: 'geometry' },
  depth: { label: 'Height / extrusion · Z', description: 'Normalized local-Z height, axial height, or prism/frustum extrusion extent; independent of canvas width and height.', control: range(0.15, 2.5, 0.01, undefined, 2), previewImpact: 'geometry' },
  apexOffsetX: { label: 'Apex offset X', description: 'Horizontal displacement of a pyramid apex from the base center, as a fraction of the base radius.', control: range(-1, 1, 0.01, undefined, 2), previewImpact: 'geometry' },
  apexOffsetY: { label: 'Apex offset Y', description: 'In-plane Y displacement of a pyramid apex from the XY base centroid, as a fraction of the base radius.', control: range(-1, 1, 0.01, undefined, 2), previewImpact: 'geometry' },
  rotationX: { label: 'X rotation', description: '3D orientation about model-space X; independent from planar object rotation.', control: range(-360, 360, 0.001, '°', 3), previewImpact: 'geometry' },
  rotationY: { label: 'Y rotation', description: '3D orientation about model-space Y; independent from planar object rotation.', control: range(-360, 360, 0.001, '°', 3), previewImpact: 'geometry' },
  rotationZ: { label: 'Z rotation', description: '3D orientation about model-space Z; independent from planar object rotation.', control: range(-360, 360, 0.001, '°', 3), previewImpact: 'geometry' },
  baseRatio: { label: 'Base width ratio', description: 'Relative X-to-Y footprint ratio of the rectangular solid.', control: range(0.5, 2.5, 0.01, undefined, 2), previewImpact: 'geometry' },
  topRadiusRatio: { label: 'Top radius ratio', description: 'Top-to-base radius ratio of a cone frustum.', control: range(0.05, 0.95, 0.01, undefined, 2), previewImpact: 'geometry' },
  stereotype: { label: 'Stereotype', description: 'Classifier stereotype text shown above its name.', control: { type: 'text', maxLength: 80, placeholder: 'Optional stereotype' }, previewImpact: 'label' },
  italicName: { label: 'Italic name', description: 'Render the classifier name in italics.', control: { type: 'checkbox' }, previewImpact: 'label' },
  underlineName: { label: 'Underline name', description: 'Underline the object/classifier name.', control: { type: 'checkbox' }, previewImpact: 'label' },
  componentGlyph: { label: 'Component glyph', description: 'Show the UML component glyph in the shape header.', control: { type: 'checkbox' }, previewImpact: 'geometry' },
  doubleBorder: { label: 'Double border', description: 'Add the notation-specific inner outline.', control: { type: 'checkbox' }, previewImpact: 'geometry' },
  innerDiamond: { label: 'Inner diamond', description: 'Add the inner diamond outline to the associative entity.', control: { type: 'checkbox' }, previewImpact: 'geometry' },
  key: { label: 'Key role', description: 'Mark this attribute as a primary or foreign key.', control: { type: 'select', options: options(['primary', 'Primary key'], ['foreign', 'Foreign key'], ['none', 'No key']) }, previewImpact: 'label' },
  underline: { label: 'Underline attribute', description: 'Underline an ER attribute to mark a key.', control: { type: 'checkbox' }, previewImpact: 'geometry' },
  lineStyle: { label: 'Line style', description: 'Stroke pattern for the shape outline and applicable interior rules.', control: { type: 'select', options: options(['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']) }, previewImpact: 'style' },
  eventKind: { label: 'Event kind', description: 'BPMN event outline: start, intermediate, or end.', control: { type: 'select', options: options(['start', 'Start'], ['intermediate', 'Intermediate'], ['end', 'End']) }, previewImpact: 'geometry' },
  marker: { label: 'Event marker', description: 'BPMN event marker shown inside the event outline.', control: { type: 'select', options: options(['none', 'None'], ['message', 'Message'], ['timer', 'Timer'], ['error', 'Error'], ['signal', 'Signal']) }, previewImpact: 'geometry' },
  taskMarker: { label: 'Task marker', description: 'BPMN task-type marker shown in the task corner.', control: { type: 'select', options: options(['none', 'None'], ['user', 'User'], ['manual', 'Manual'], ['service', 'Service'], ['script', 'Script'], ['rule', 'Business rule'], ['receive', 'Receive'], ['send', 'Send']) }, previewImpact: 'geometry' },
  callActivity: { label: 'Call activity border', description: 'Emphasize the call-activity border.', control: { type: 'checkbox' }, previewImpact: 'style' },
  subprocess: { label: 'Expandable subprocess', description: 'Show the subprocess marker at the bottom center.', control: { type: 'checkbox' }, previewImpact: 'geometry' },
  gatewayMarker: { label: 'Gateway marker', description: 'BPMN gateway control marker.', control: { type: 'select', options: options(['x', 'Exclusive (X)'], ['circle', 'Inclusive (O)'], ['plus', 'Parallel (+)'], ['event', 'Event'], ['none', 'None']) }, previewImpact: 'geometry' },
  messageEnvelope: { label: 'Message envelope', description: 'Show a folded document or envelope marker, as appropriate to this BPMN artifact.', control: { type: 'checkbox' }, previewImpact: 'geometry' },
});

/** Legacy schema keys are retained for persisted boards, but are deliberately not editor controls. */
export const LEGACY_SHAPE_PARAMETER_METADATA: Readonly<Record<string, string>> = Object.freeze({
  cornerRadius: 'Legacy absolute corner radius. New controls use cornerRadiusRatio so resizing remains proportional.',
  keyColumns: 'Legacy table split hint. Structured table column data is authoritative.',
  title: 'Legacy title fallback. Shape text is edited through the shared Name / label field.',
  lollipop: 'Legacy UML interface decoration value; provided/required identity is carried by the semantic definition.',
  history: 'Legacy history-kind marker; shallow/deep history are separate semantic definitions.',
  pseudostate: 'Legacy pseudostate-kind marker; the selected semantic definition is authoritative.',
});

const DERIVED_PARAMETER_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  compartments: 'Derived from classifier/table data; edit the semantic compartments rather than this cached count.',
  rowCount: 'Derived from table columns or classifier compartments; not edited independently.',
});

const humanize = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, character => character.toUpperCase());

export function buildShapeParameterMetadata(
  definition: Pick<ShapeDefinition, 'defaultParams'> & Partial<Pick<ShapeDefinition, 'id' | 'geometry'>>,
): readonly ShapeParameterMetadata[] {
  return Object.entries(definition.defaultParams ?? {}).map(([key, defaultValue]) => {
    const schema = SHAPE_PARAMETER_SCHEMA[key];
    const legacyDescription = LEGACY_SHAPE_PARAMETER_METADATA[key];
    const derivedDescription = DERIVED_PARAMETER_DESCRIPTIONS[key];
    const identityLocked = key === 'depth' && (definition.geometry === 'tetrahedron3d' || definition.geometry === 'octahedron3d');
    const status: ShapeParameterMetadata['status'] = derivedDescription ? 'derived'
      : legacyDescription ? 'legacy'
        : identityLocked ? 'internal'
          : schema?.control ? 'user-editable' : 'internal';
    return Object.freeze({
      key,
      label: schema?.label ?? humanize(key),
      status,
      description: derivedDescription ?? legacyDescription ?? (identityLocked
        ? 'Fixed at its mathematical regular-solid default so the shape remains a true tetrahedron/octahedron.'
        : schema?.description) ?? 'Internal implementation parameter; not user-editable.',
      defaultValue,
      ...(status === 'user-editable' && schema?.control ? { control: schema.control } : {}),
      previewImpact: schema?.previewImpact ?? 'none',
    });
  });
}

export function normalizeShapeParameterPatch(
  definition: Pick<ShapeDefinition, 'defaultParams' | 'parameterMetadata'>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, string | number | boolean> {
  const metadata = new Map((definition.parameterMetadata ?? buildShapeParameterMetadata(definition))
    .filter(parameter => parameter.status === 'user-editable' && parameter.control)
    .map(parameter => [parameter.key, parameter]));
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(patch)) {
    const parameter = metadata.get(key), control = parameter?.control;
    if (!parameter || !control) continue;
    if (control.type === 'range') {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const clamped = Math.max(control.min, Math.min(control.max, value));
      const stepped = control.min + Math.round((clamped - control.min) / control.step) * control.step;
      const decimals = control.precision ?? Math.min(12, Math.max(0, (String(control.step).split('.')[1] ?? '').length));
      normalized[key] = Number(Math.max(control.min, Math.min(control.max, stepped)).toFixed(decimals));
    } else if (control.type === 'select') {
      const option = control.options.find(candidate => Object.is(candidate.value, value));
      if (option) normalized[key] = option.value;
    } else if (control.type === 'checkbox') {
      if (typeof value === 'boolean') normalized[key] = value;
    } else if (control.type === 'text') {
      if (typeof value === 'string') normalized[key] = control.maxLength === undefined ? value : value.slice(0, control.maxLength);
    }
  }
  return normalized;
}

export function shapeDataCapabilities(
  definition: Pick<ShapeDefinition, 'defaultData'>,
): readonly ShapeDataCapability[] {
  const data = definition.defaultData;
  if (!data || typeof data !== 'object') return [];
  return (['classifier', 'table', 'column'] as const).filter(capability => capability in data);
}
