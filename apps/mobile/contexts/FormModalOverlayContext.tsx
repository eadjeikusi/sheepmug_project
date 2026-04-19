import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

type Ctx = { setOverlay: (node: ReactNode | null) => void };

const FormModalOverlayContext = createContext<Ctx | null>(null);

export function useFormModalOverlay() {
  return useContext(FormModalOverlayContext);
}

/** Wraps modal content and hosts absolute overlays (e.g. iOS date pickers without nested Modals). */
export function FormModalOverlayHost({ children }: { children: ReactNode }) {
  const [overlayNode, setOverlayState] = useState<ReactNode>(null);
  const setOverlay = useCallback((node: ReactNode | null) => {
    setOverlayState(node);
  }, []);
  const value = useMemo(() => ({ setOverlay }), [setOverlay]);
  return (
    <FormModalOverlayContext.Provider value={value}>
      <View style={styles.host}>
        {children}
        {overlayNode ? (
          <View style={styles.overlaySlot} pointerEvents="box-none">
            {overlayNode}
          </View>
        ) : null}
      </View>
    </FormModalOverlayContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, position: "relative" },
  overlaySlot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
  },
});
