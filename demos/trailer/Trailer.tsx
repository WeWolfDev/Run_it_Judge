import { Director, type Scene } from "./Director";
import { score } from "./audio";

import {
  AWARD_MS,
  AwardsScene,
  CodingScene,
  EventScene,
  IntroScene,
  OutroScene,
  TitleScene,
  TrackScene,
  WinnerScene,
} from "./scenes";

// Tráiler de Run It: el guion. La reproducción y los controles están en
// Director; la vista celular 9:16 para grabar desde el PC, también.

const SCENES: Scene[] = [
  {
    id: "intro",
    section: "intro",
    label: "Bienvenidos",
    ms: 4600,
    cut: "boot",
    render: () => <IntroScene />,
  },
  {
    id: "lema",
    section: "build",
    label: "Solo uno en pie",
    ms: 5600,
    cut: "glitch",
    render: () => (
      <TitleScene
        text="Torneo de programación competitiva al estilo gamer donde solo uno queda en pie"
        accent={["gamer", "uno", "pie"]}
        size="md"
      />
    ),
  },
  {
    id: "pista",
    section: "full",
    label: "La pista",
    ms: 14000,
    cut: "flash",
    render: () => <TrackScene />,
  },
  {
    id: "enfrentate",
    section: "build",
    label: "Enfréntate",
    ms: 3800,
    cut: "glitch",
    render: () => (
      <TitleScene
        text="Enfréntate para ver quién es el vencedor"
        accent={["vencedor"]}
      />
    ),
  },
  {
    id: "codigo",
    section: "full",
    label: "A programar",
    ms: 11800,
    cut: "flash",
    render: () => <CodingScene />,
  },
  {
    id: "ganador",
    section: "build",
    label: "Un ganador",
    ms: 2800,
    cut: "glitch",
    render: () => (
      <TitleScene text="Un ganador" accent={["ganador"]} size="xl" />
    ),
  },
  {
    id: "campeon",
    section: "triumph",
    label: "El campeón",
    ms: 7200,
    cut: "flash",
    render: () => <WinnerScene />,
  },
  {
    id: "premios-titulo",
    section: "build",
    label: "Más premios",
    ms: 3400,
    cut: "glitch",
    render: () => (
      <TitleScene
        text="Más premios y regalos"
        accent={["premios", "regalos"]}
      />
    ),
  },
  {
    id: "premios",
    section: "triumph",
    label: "Premios",
    ms: AWARD_MS * 3,
    cut: "flash",
    render: () => <AwardsScene />,
  },
  {
    id: "solo",
    section: "full",
    label: "Solo en Run It",
    ms: 3000,
    cut: "glitch",
    render: () => (
      <TitleScene text="Solo en Run It" accent={["Run", "It"]} size="xl" />
    ),
  },
  {
    id: "animas",
    section: "build",
    label: "¿Te animas?",
    ms: 3600,
    cut: "glitch",
    render: () => (
      <TitleScene text="¿Te animas a participar?" accent={["participar?"]} />
    ),
  },
  {
    id: "evento",
    section: "full",
    label: "El evento",
    ms: 6800,
    cut: "boot",
    render: () => <EventScene />,
  },
  {
    id: "logos",
    section: "outro",
    label: "Logos",
    ms: 7000,
    cut: "white",
    render: () => <OutroScene />,
  },
];

export function Trailer() {
  return <Director scenes={SCENES} score={score} eyebrow="Run It · tráiler" />;
}
