/**
 * pdfjs-dist ships no types for the worker entry point. It is imported purely
 * for its side effect (registering the in-process worker), so an opaque module
 * declaration is all that is needed.
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
