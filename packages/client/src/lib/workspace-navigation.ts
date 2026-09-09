import { useUIStore, type WorkspaceView } from "../stores/ui.store";
import { useChatStore } from "../stores/chat.store";
import { deferEditorLeave, leaveWithoutSaving } from "./editor-leave";

/** Use the existing editor save gate before changing both UI and chat state. */
export function leaveWorkspaceEditor(navigate: () => void) {
  const ui = useUIStore.getState();
  const proceed = () =>
    leaveWithoutSaving(() => {
      ui.closeAllDetails();
      navigate();
    });
  const leavingEditors = {
    characterDetailId: null,
    personaDetailId: null,
    lorebookDetailId: null,
    presetDetailId: null,
    connectionDetailId: null,
    agentDetailId: null,
    toolDetailId: null,
    regexDetailId: null,
  };
  if (!deferEditorLeave(ui, leavingEditors, proceed)) proceed();
}

export function openWorkspace(view: WorkspaceView = "workspace") {
  leaveWorkspaceEditor(() => {
    const ui = useUIStore.getState();
    ui.closeRightPanel();
    ui.setSidebarOpen(false);
    ui.setWorkspaceView(view);
    useChatStore.getState().setActiveChatId(null);
  });
}
