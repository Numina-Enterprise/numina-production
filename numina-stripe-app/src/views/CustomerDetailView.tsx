import React from "react";
import {
  Box,
  ContextView,
  Inline,
  Text,
  Badge,
} from "@stripe/ui-extension-sdk/ui";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";

export const CustomerDetailView = ({ userContext }: ExtensionContextValue) => {
  return (
    <ContextView title="Numina Customer Allocation">
      <Box css={{ stack: "y", gap: "medium" }}>
        <Inline css={{ distribution: "space-between", alignY: "center" }}>
          <Text weight="bold">Settlement Status</Text>
          <Badge type="positive">COMMITTED_SETTLED</Badge>
        </Inline>
        <Inline css={{ distribution: "space-between" }}>
          <Text color="secondary">Ledger Format</Text>
          <Text weight="medium">Integer BigInt (10⁻⁶)</Text>
        </Inline>
        <Inline css={{ distribution: "space-between" }}>
          <Text color="secondary">Disbursement Auth</Text>
          <Text weight="medium">Dual-Key Ed25519</Text>
        </Inline>
      </Box>
    </ContextView>
  );
};

export default CustomerDetailView;
