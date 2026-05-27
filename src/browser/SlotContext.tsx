import { createContext, useContext, type ReactNode } from "react";

type SlotContextValue = {
  sessionId: string;
  slotId: string;
};

const SlotContext = createContext<SlotContextValue | null>(null);

type SlotContextProviderProps = SlotContextValue & {
  children: ReactNode;
};

export function SlotContextProvider({ sessionId, slotId, children }: SlotContextProviderProps) {
  return (
    <SlotContext.Provider value={{ sessionId, slotId }}>
      {children}
    </SlotContext.Provider>
  );
}

export function useSlotContext(): SlotContextValue {
  const value = useContext(SlotContext);
  if (!value) {
    throw new Error("useSlotContext must be used inside SlotContextProvider");
  }
  return value;
}
