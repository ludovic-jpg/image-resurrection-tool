import { useState, type InputHTMLAttributes } from "react";
import { Champ, type PropsChamp } from "./base";

/** Champ mot de passe avec case « Afficher le mot de passe » (accessible au clavier et aux lecteurs d'écran). */
export function ChampMotDePasse(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & PropsChamp,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <Champ {...props} type={visible ? "text" : "password"} />
      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-[13px] text-encre-2">
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
          className="size-4 accent-accent"
        />
        Afficher le mot de passe
      </label>
    </div>
  );
}
