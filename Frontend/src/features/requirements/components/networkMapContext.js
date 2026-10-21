import { createContext } from "react";

// Shared by NetworkMap and its custom edges (they are rendered inside ReactFlow, so props cannot reach them directly):
//   linkMode  - true while "Link Requirements" mode is on; edge clicks must then do nothing
//   openLink  - (link, edgeId) => opens the "Link details" panel
export const NetworkMapContext = createContext({ linkMode: false, openLink: () => {} });
