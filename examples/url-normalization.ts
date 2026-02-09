/**
 * URL normalization — how unsurf turns specific URLs into patterns.
 * This file is embedded in the docs and tested in CI.
 */
import { extractDomain, normalizeUrlPattern } from "unsurf";

// Numeric IDs → :id
console.log(normalizeUrlPattern("https://api.example.com/users/42"));
// → https://api.example.com/users/:id

// UUIDs → :id
console.log(
	normalizeUrlPattern("https://api.example.com/posts/550e8400-e29b-41d4-a716-446655440000"),
);
// → https://api.example.com/posts/:id

// Base64 tokens → :id
console.log(normalizeUrlPattern("https://api.example.com/sessions/SGVsbG8gV29ybGQhIQ=="));
// → https://api.example.com/sessions/:id

// Literal path segments stay as-is
console.log(normalizeUrlPattern("https://api.example.com/api/v2/users"));
// → https://api.example.com/api/v2/users

// Extract domain
console.log(extractDomain("https://app.example.com/dashboard"));
// → app.example.com
