/**
 * The vector kernel's public surface.
 *
 * Everything an editor, an exporter or an importer needs is exported from here, so callers do not
 * reach into individual modules and accidentally depend on an internal detail (ADR-0020).
 */

export * from './types';
export * from './tolerance';
export * from './style';
export {
  segmentsOf,
  segmentBetween,
  allSegments,
  hasCurves,
  isClosedContour,
  validatePath,
  isUsablePath,
  pointsOf,
  translatePath,
  reverseContour,
  reversePath,
  setContourClosed,
  withoutEmptyContours,
} from './path';
export type { PathIssue, PathIssueCode } from './path';
export * from './bounds';
export {
  IDENTITY,
  matrix,
  translation,
  scaling,
  rotation,
  apply,
  applyToPoint,
  determinant,
  isIdentity,
  invert,
  transformPath,
  transformBox,
  matrixBetweenBoxes,
  frameMatrixFor,
} from './transform';
export type { Matrix } from './transform';
export {
  areaOfContour,
  areaOfPath,
  signedAreaOfContour,
  signedAreaOfPath,
  isAreaContour,
  centroidOfContour,
  centroidOfPath,
} from './area';
export {
  flattenContour,
  flattenPath,
  flattenSegment,
  flattenedSegmentCount,
  pointOnSegment,
  tangentOnSegment,
  splitCubic,
  closestPointOnPath,
  insertNodeBetween,
  pathFromPolylines,
  toPolylines,
  distance,
  MAX_SUBDIVISION_DEPTH,
} from './flatten';
export type { FlatContour, ClosestPoint, FlattenOptions } from './flatten';
export {
  pathContainsPoint,
  distanceToPath,
  hitTestPath,
  pathIntersectsBox,
  shapeIntersectsBox,
  segmentIntersectsBox,
  segmentsProperlyCross,
  flattenedSegments,
} from './hit';
export type { HitOptions, HitResult } from './hit';
export { checkTopology, isTopologicallyValid } from './validity';
export type { TopologyIssue, TopologyIssueCode, TopologyOptions, TopologyReport } from './validity';
export {
  booleanPaths,
  describeBooleanResult,
  BOOLEAN_OPERATION_HINTS,
  BOOLEAN_OPERATION_LABELS,
} from './boolean';
export type { BooleanOperation, BooleanOptions, BooleanResult } from './boolean';
export { parsePathData, toPathData, toVerbosePathData } from './path-data';
export type { PathDataError, ParsedPathData, PathDataOptions } from './path-data';
export {
  rectanglePath,
  ellipsePath,
  regularPolygonPath,
  linePath,
  starPath,
  CIRCLE_KAPPA,
} from './shapes';
export {
  moveNode,
  moveNodeBy,
  moveHandle,
  setNodeHandles,
  setNodeKind,
  deleteNode,
  insertNodeAt,
  simplifyPath,
  fitPathIntoBox,
  segmentCount,
  midpointOfSegment,
} from './ops';
export type {
  HandleSide,
  HandleMirroring,
  NodeKind,
  DeleteNodeOutcome,
  InsertNodeOutcome,
} from './ops';
export {
  penStart,
  penAddNode,
  penDragHandle,
  penSetPointer,
  penCanClose,
  penClose,
  penToPath,
  penPreview,
  PEN_CLOSE_DISTANCE,
} from './pen';
export type { PenDraft } from './pen';
export {
  PICK_RADIUS,
  pickPathTarget,
  nodesInBox,
  insertionPointFor,
  visibleHandles,
  segmentTotal,
} from './pick';
export type { PickTarget, PickOptions, NodeReference } from './pick';
