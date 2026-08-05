import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../types";
import { effectiveSchema, schemaFieldTypes } from "./jsonSchema";

describe("jsonSchema helpers", () => {
  it("resolves Pydantic v1 definitions references", () => {
    const rootSchema: JsonSchema = {
      type: "object",
      definitions: {
        Endpoint: {
          type: "string",
          title: "Endpoint",
          default: "https://api.example.com",
        },
      },
      properties: {
        endpoint: { $ref: "#/definitions/Endpoint" },
      },
    };

    const fieldSchema = rootSchema.properties?.endpoint ?? {};

    expect(effectiveSchema(fieldSchema, rootSchema)).toMatchObject({
      type: "string",
      title: "Endpoint",
      default: "https://api.example.com",
    });
    expect(schemaFieldTypes(fieldSchema, rootSchema)).toEqual(["string"]);
  });

  it("decodes escaped JSON Pointer reference segments", () => {
    const rootSchema: JsonSchema = {
      type: "object",
      $defs: {
        "Path/Token~Secret": {
          type: "string",
          title: "Escaped Endpoint",
        },
      },
      properties: {
        endpoint: { $ref: "#/$defs/Path~1Token~0Secret" },
      },
    };

    const fieldSchema = rootSchema.properties?.endpoint ?? {};

    expect(effectiveSchema(fieldSchema, rootSchema)).toMatchObject({
      type: "string",
      title: "Escaped Endpoint",
    });
  });
});