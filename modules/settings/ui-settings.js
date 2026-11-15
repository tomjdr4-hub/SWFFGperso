class ffgSettings extends FormApplication {
  activateListeners(html) {
    super.activateListeners(html);
    html.find("button.filepicker").click(this._onFilePicker.bind(this));
  }

  getData(acceptableSettings) {
    const canConfigure = game.user.can("SETTINGS_MODIFY");
    let includeSettings = [];
    for (const setting of game.settings.settings) {
      if (acceptableSettings.includes(setting[0])) {
        const s = foundry.utils.duplicate(setting[1]);
        s.name = game.i18n.localize(s.name);
        s.hint = game.i18n.localize(s.hint);
        s.value = game.settings.get(s.namespace, s.key);
        s.type = setting.type instanceof Function ? setting.type.name : "String";
        s.isCheckbox = setting[1].type === Boolean;
        s.isSelect = s.choices !== undefined;
        s.isRange = setting[1].type === Number && s.range;
        s.isFilePicker = setting.valueType === "FilePicker";
        includeSettings.push(s);
      }
    }

    const data = {
      system: {title: game.system.title, menus: [], settings: includeSettings},
    };

    // Return data
    return {
      user: game.user,
      canConfigure: canConfigure,
      systemTitle: game.system.title,
      data: data,
    };
  }

  _onFilePicker(event) {
    event.preventDefault();

    const fp = new foundry.applications.apps.FilePicker({
      type: "image",
      callback: (path) => {
        $(event.currentTarget).prev().val(path);
        //this._onSubmit(event);
      },
      top: this.position.top + 40,
      left: this.position.left + 10,
    });
    return fp.browse();
  }

    /** @override */
  async _updateObject(event, formData) {
    for (let [k, v] of Object.entries(foundry.utils.flattenObject(formData))) {
      let s = game.settings.settings.get(k);
      let current = game.settings.get(s.namespace, s.key);
      if (v !== current) {
        await game.settings.set(s.namespace, s.key, v);
      }
    }
  }
}

export class rulesetSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ruleset-settings",
      classes: ["starwarsffg-v14", "ruleset-settings"],
      title: `${game.i18n.localize("SWFFG.Settings.ruleset.Title")}`,
      template: "systems/starwarsffg-v14/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
        "starwarsffg-v14.dicetheme",
        "starwarsffg-v14.vehicleRangeBand",
        "starwarsffg-v14.skilltheme",
        "starwarsffg-v14.enableForceDie",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class uiSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "ui-settings",
      classes: ["starwarsffg-v14", "ui-settings"],
      title: `${game.i18n.localize("SWFFG.Settings.ui.Title")}`,
      template: "systems/starwarsffg-v14/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg-v14.ui-uitheme",
      "starwarsffg-v14.ui-pausedImage",
      "starwarsffg-v14.ui-token-healthy",
      "starwarsffg-v14.ui-token-wounded",
      "starwarsffg-v14.ui-token-overwounded",
      "starwarsffg-v14.ui-token-stamina-ok",
      "starwarsffg-v14.ui-token-stamina-damaged",
      "starwarsffg-v14.ui-token-stamina-over",
      "starwarsffg-v14.displaySimulation",
      "starwarsffg-v14.rollSimulation",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class combatSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "combat-settings",
      classes: ["starwarsffg-v14", "combat-settings"],
      title: `${game.i18n.localize("SWFFG.Settings.combat.Title")}`,
      template: "systems/starwarsffg-v14/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg-v14.useGenericSlots",
      "starwarsffg-v14.initiativeRule",
      "starwarsffg-v14.removeCombatantAction",
      "starwarsffg-v14.useDefense",
      "starwarsffg-v14.additionalStatuses",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class actorSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "actor-settings",
      classes: ["starwarsffg-v14", "actor-settings"],
      title: `${game.i18n.localize("SWFFG.Settings.actor.Title")}`,
      template: "systems/starwarsffg-v14/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg-v14.enableSoakCalc",
      "starwarsffg-v14.talentSorting",
      "starwarsffg-v14.showMinionCount",
      "starwarsffg-v14.showAdversaryCount",
      "starwarsffg-v14.adversaryItemName",
      "starwarsffg-v14.maxAttribute",
      "starwarsffg-v14.maxSkill",
      "starwarsffg-v14.medItemName",
      "starwarsffg-v14.HealingItemAction",
      "starwarsffg-v14.consumeHealingItem",
      "starwarsffg-v14.RivalTokenPrepend",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class xpSpendingSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "xpSpending",
      classes: ["starwarsffg-v14", "xpSpending"],
      title: `${game.i18n.localize("SWFFG.Settings.xpSpending.Title")}`,
      template: "systems/starwarsffg-v14/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg-v14.specializationCompendiums",
      "starwarsffg-v14.signatureAbilityCompendiums",
      "starwarsffg-v14.forcePowerCompendiums",
      "starwarsffg-v14.talentCompendiums",
      "starwarsffg-v14.backgroundCompendiums",
      "starwarsffg-v14.obligationCompendiums",
      "starwarsffg-v14.speciesCompendiums",
      "starwarsffg-v14.careerCompendiums",
      "starwarsffg-v14.motivationCompendiums",
      "starwarsffg-v14.itemCompendiums",
      "starwarsffg-v14.notifyOnXpSpend",
      "starwarsffg-v14.defaultObligation",
      "starwarsffg-v14.defaultDuty",
      "starwarsffg-v14.defaultMorality",
      "starwarsffg-v14.maxRarity",
      "starwarsffg-v14.allowRestricted",
      "starwarsffg-v14.defaultCredits",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class localizationSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "localization",
      classes: ["starwarsffg-v14", "localization"],
      title: `${game.i18n.localize("SWFFG.Settings.localization.Title")}`,
      template: "systems/starwarsffg-v14/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg-v14.skillSorting",
      "starwarsffg-v14.destiny-pool-light",
      "starwarsffg-v14.destiny-pool-dark",
    ];
    return super.getData(includeSettingsNames);
  }
}

export class groupManagerSettings extends ffgSettings {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "group-manager",
      classes: ["starwarsffg-v14", "group-manager"],
      title: `${game.i18n.localize("SWFFG.Settings.groupManager.Title")}`,
      template: "systems/starwarsffg-v14/templates/dialogs/ffg-ui-settings.html",
    });
  }

  getData(options) {
    const includeSettingsNames = [
      "starwarsffg-v14.pcListMode",
      "starwarsffg-v14.privateTriggers",
      "starwarsffg-v14.GMCharactersInGroupManager"
    ];
    return super.getData(includeSettingsNames);
  }
}
