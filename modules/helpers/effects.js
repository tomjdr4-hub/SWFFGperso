export default class EffectHelpers {

  // Map effects from EmbeddedCollection
  static transformEffects(originalEffect, _iterator, _effects) {
    // Build a plain object from the source data rather than cloning the Document itself
    const effect = originalEffect.toObject();

    // Copy properties we need from the prototype
    effect.id = originalEffect.id;
    effect.parentName = originalEffect.parent.name;
    effect.active = originalEffect.active;

    // Convert duration to string (V14 stores durations as a value + units pair)
    const {value, units} = originalEffect.duration ?? {};
    if (originalEffect.start?.combat) {
      effect.duration = game.i18n.localize("SWFFG.Effect.Duration.CurrentCombat");
    } else if (typeof value === "number" && value > 0 && units === "seconds") {
      effect.duration = `${value} ${game.i18n.localize("SWFFG.Effect.Duration.Seconds")}`;
    } else if (typeof value === "number" && value > 0 && units === "rounds") {
      effect.duration = `${value} ${game.i18n.localize("SWFFG.Effect.Duration.Rounds")}`;
    } else if (typeof value === "number" && value > 0 && units === "turns") {
      effect.duration = `${value} ${game.i18n.localize("SWFFG.Effect.Duration.Turns")}`;
    } else if (typeof value === "number" && value > 0) {
      effect.duration = `${value} ${units}`;
    } else {
      effect.duration = game.i18n.localize("SWFFG.Effect.Duration.Permanent");
    }

    // Update each change from this effect
    effect.changes = (effect.system?.changes ?? []).map((change) => {
      const display = {...change};
      // Display the change type in upper case (as the legacy mode names were)
      display.mode = String(change.type ?? "").toUpperCase();

      // LStrip 'system.' for shorter keys
      if (display.key.startsWith("system.")) {
        display.key = display.key.substring(7);
      }
      return display;
    });

    return effect;
  }
}
