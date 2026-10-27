/** S0 schema catalog only: no handler, registrar, route or executable transport. */
import { CommandSignalFacetInputSchema } from "./signal-command-schemas.js";
import { CommandLotFacetInputSchema, BatchLotFacetCommandsInputSchema } from "./lot-command-schemas.js";
import { GetFacetContextInputSchema, GetSignalFacetsInputSchema,
  GetLotFacetsInputSchema } from "./read-schemas.js";
import {
  GetFacetContextOutputSchema, GetSignalFacetsOutputSchema, GetLotFacetsOutputSchema,
  CommandSignalFacetOutputSchema, CommandLotFacetOutputSchema, BatchLotFacetCommandsOutputSchema,
} from "./response-schemas.js";

export const STATUS_TOOL_CONTRACTS = {
  get_facet_context: { input: GetFacetContextInputSchema, output: GetFacetContextOutputSchema },
  get_signal_facets: { input: GetSignalFacetsInputSchema, output: GetSignalFacetsOutputSchema },
  command_signal_facet: { input: CommandSignalFacetInputSchema, output: CommandSignalFacetOutputSchema },
  get_lot_facets: { input: GetLotFacetsInputSchema, output: GetLotFacetsOutputSchema },
  command_lot_facet: { input: CommandLotFacetInputSchema, output: CommandLotFacetOutputSchema },
  batch_lot_facet_commands: { input: BatchLotFacetCommandsInputSchema,
    output: BatchLotFacetCommandsOutputSchema },
} as const;
