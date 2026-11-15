export default class PauseFFG extends foundry.applications.ui.GamePause {
  static get defaultOptions() {
    const options = super.defaultOptions;
    options.id = "pause";
    options.template = "systems/starwarsffg-v14/templates/parts/ffg-paused.html";
    options.popOut = false;
    return options;
  }

  getData() {
    let icon = game.settings.get("starwarsffg-v14", "ui-pausedImage");
    if (icon?.length <= 0) {
      icon = "icons/svg/clockwork.svg";
    }

    return {
      paused: game.paused,
      icon,
    };
  }
}
