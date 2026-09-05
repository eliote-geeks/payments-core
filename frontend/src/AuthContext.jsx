// Compatibility re-export for older relative imports. The implementation uses
// HttpOnly cookies from context/AuthContext and never stores access tokens.
export { AuthProvider, useAuth } from "./context/AuthContext";
