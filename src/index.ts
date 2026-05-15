export {
  createELSExpressLogger,
  createELSErrorHandler,
} from "./middleware.js";
export type { ELSExpressOptions } from "./middleware.js";

// Re-export ELSClient и типы — чтобы можно было устанавливать только @inso_web/els-express
export { ELSClient } from "@inso_web/els-client";
export type {
  ELSConfig,
  ErrorEntry,
  Logger,
  LogLevel,
} from "@inso_web/els-client";
