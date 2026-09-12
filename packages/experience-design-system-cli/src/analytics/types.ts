/** Tracked CLI commands — closed set aligned with the published event schema. */
export type DsiCliCommand =
  | 'analyze_extract'
  | 'analyze_select'
  | 'generate_components'
  | 'generate_tokens'
  | 'generate_edit'
  | 'map_tokens'
  | 'apply_preview'
  | 'apply_select'
  | 'apply_push'
  | 'print_components'
  | 'print_tokens'
  | 'import';

export type EntryCommand = 'analyze_extract' | 'import';

export type OsName = 'macOS' | 'Linux' | 'Windows' | 'Android' | 'other';

export type WriteResult = {
  created_count: number;
  updated_count: number;
  failed_count: number;
};

export type CommandContext = {
  space_key?: string;
  environment_key?: string;
  x_contentful_request_id?: string;
};

export type CommandCompletion = CommandContext & {
  dsi_operation_id?: string;
  extracted_component_count?: number;
  accepted_component_count?: number;
  component_type_result?: WriteResult;
  design_token_result?: WriteResult;
};

export type CommandFailure = CommandContext & {
  dsi_operation_id?: string;
  error_name?: string;
  error_code?: string;
  http_status_code?: number;
  exit_code?: number;
};
