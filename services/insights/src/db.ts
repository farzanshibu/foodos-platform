import "server-only";

import { createDb } from "@foodos/db";

import * as schema from "./schema";

export const db = createDb(schema);
