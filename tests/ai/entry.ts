// Tout ce que les tests de l'assistant IA utilisent (construit par scripts/test-ai.mjs).
export { createHandler, fitHistory, tokens } from '../../src/ai/server/handler';
export { ThinkFilter, stripThink, forgetChoice } from '../../src/ai/server/llm';
export { checkSelect } from '../../src/ai/server/data';
export { ctxFor, runTool, toolsFor, period } from '../../src/ai/server/tools';
export { get } from '../../src/lib/db';
