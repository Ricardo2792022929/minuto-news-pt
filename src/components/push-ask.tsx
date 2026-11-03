import {
  FlowShell,
  NOTIFICATION_SIZE,
  NotificationMock,
  PrimaryButton,
  SheetActions,
  SheetHeader,
  Stage,
  TextButton,
  TopBar,
} from "./onboarding-kit";

/** Conteúdo da folha do aviso. Usado no fim da primeira utilização e, sozinho, em quem já tinha a app. */
export function PushSheet({
  busy,
  onYes,
  onNo,
}: {
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <>
      <SheetHeader
        title="Sê o primeiro a saber"
        hint="Um aviso no telemóvel quando sai uma notícia importante. Mesmo com a app fechada."
      />
      <p className="flex-1 px-6 pt-5 text-sm leading-5 text-ob-fg2">
        O Android pode pedir a tua autorização. Podes desligar os avisos nas definições do
        telemóvel.
      </p>
      <SheetActions>
        <PrimaryButton onClick={onYes} disabled={busy}>
          {busy ? "A ativar…" : "Ativar avisos"}
        </PrimaryButton>
        <TextButton onClick={onNo} disabled={busy}>
          Agora não
        </TextButton>
      </SheetActions>
    </>
  );
}

export function PushAsk({
  busy,
  onYes,
  onNo,
}: {
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <FlowShell
      top={<TopBar total={0} index={0} />}
      stage={
        <Stage {...NOTIFICATION_SIZE}>
          <NotificationMock />
        </Stage>
      }
      sheet={
        <div className="ob-slide flex min-h-0 flex-1 flex-col">
          <PushSheet busy={busy} onYes={onYes} onNo={onNo} />
        </div>
      }
    />
  );
}
