import { createContext, useContext } from "react";
import type { Catalog, Schedule } from "./api";
export const ConsoleContext = createContext<{
  catalog?: Catalog;
  schedule?: Schedule;
  id: string;
  select: (id: string) => void;
  order: string;
  focusOrder: (order: string) => void;
}>({ id: "", select: () => {}, order: "", focusOrder: () => {} });
export const useConsole = () => useContext(ConsoleContext);
