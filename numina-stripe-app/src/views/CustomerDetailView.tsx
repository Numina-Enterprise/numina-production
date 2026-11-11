import React from "react";
import {
  Badge,
  Box,
  ContextView,
  Inline,
} from "@stripe/ui-extension-sdk/ui";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";

export const CustomerDetailView = (_context: ExtensionContextValue) => {
  return (
    <ContextView title="Numina Customer Allocation">
      <Box css={{ layout: "column", gap: "medium" }}>
        <Inline css={{ layout: "row", gap: "medium", alignY: "center" }}>
          <Box css={{ font: "bodyEmphasized" }}>Settlement Status</Box>
          <Badge type="positive">COMMITTED_SETTLED</Badge>
        </Inline>
        <Inline css={{ layout: "row", gap: "medium", alignY: "center" }}>
          <Box css={{ color: "secondary" }}>Ledger Format</Box>
          <Box css={{ font: "bodyEmphasized" }}>Integer BigInt (10⁻⁶)</Box>
        </Inline>
        <Inline css={{ layout: "row", gap: "medium", alignY: "center" }}>
          <Box css={{ color: "secondary" }}>Disbursement Auth</Box>
          <Box css={{ font: "bodyEmphasized" }}>Dual-Key Ed25519</Box>
        </Inline>
      </Box>
    </ContextView>
  );
};

export default CustomerDetailView;
