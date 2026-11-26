import { handle } from "../lib/broker.js";

export function GET(request: Request): Promise<Response> {
  return handle(request, process.env);
}

export function POST(request: Request): Promise<Response> {
  return handle(request, process.env);
}
