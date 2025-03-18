document.addEventListener('DOMContentLoaded', () => {
  const toggleButton = document.getElementById('toggleMonitoring');
  const selectButton = document.getElementById('selectElement');
  const selectorHelp = document.getElementById('selectorHelp');
  const statusDiv = document.getElementById('status');
  const selectorInput = document.getElementById('selector');
  const textInput = document.getElementById('text');
  const intervalInput = document.getElementById('interval');

  let isSelecting = false;

  // Charger les paramètres sauvegardés
  chrome.storage.local.get(['isMonitoring', 'selector', 'text', 'interval'], (result) => {
    if (result.selector) selectorInput.value = result.selector;
    if (result.text) textInput.value = result.text;
    if (result.interval) intervalInput.value = result.interval;
    
    if (result.isMonitoring) {
      toggleButton.textContent = 'Arrêter la surveillance';
      statusDiv.textContent = 'Surveillance active';
      statusDiv.classList.remove('inactive');
      statusDiv.classList.add('active');
    }
  });

  // Vérifier périodiquement l'état de la sélection
  const checkSelectionState = () => {
    chrome.storage.local.get(['selectedSelector', 'selectedText', 'selectionComplete', 'selectionError'], (result) => {
      if (result.selectionError) {
        isSelecting = false;
        selectButton.textContent = 'Sélectionner un élément';
        selectButton.classList.remove('active');
        selectorHelp.classList.remove('visible');
        alert(result.selectionError);
        // Nettoyer l'erreur
        chrome.storage.local.remove('selectionError');
      } else if (result.selectionComplete && result.selectedSelector) {
        isSelecting = false;
        selectButton.textContent = 'Sélectionner un élément';
        selectButton.classList.remove('active');
        selectorHelp.classList.remove('visible');
        selectorInput.value = result.selectedSelector;
        textInput.value = result.selectedText;
        // Sauvegarder le sélecteur et le texte
        chrome.storage.local.set({ 
          selector: result.selectedSelector,
          text: result.selectedText
        });
        // Nettoyer l'état de sélection
        chrome.storage.local.remove(['selectedSelector', 'selectedText', 'selectionComplete']);
      }
    });
  };

  // Démarrer la vérification périodique
  const selectionCheckInterval = setInterval(checkSelectionState, 100);

  // Gestionnaire pour le bouton de sélection
  selectButton.addEventListener('click', async () => {
    if (!isSelecting) {
      // Démarrer le mode sélection
      isSelecting = true;
      selectButton.textContent = 'Annuler la sélection';
      selectButton.classList.add('active');
      selectorHelp.classList.add('visible');

      // Envoyer un message au background script pour activer le mode sélection
      chrome.runtime.sendMessage({ action: 'startElementSelection' });
    } else {
      // Annuler le mode sélection
      isSelecting = false;
      selectButton.textContent = 'Sélectionner un élément';
      selectButton.classList.remove('active');
      selectorHelp.classList.remove('visible');

      // Envoyer un message au background script pour désactiver le mode sélection
      chrome.runtime.sendMessage({ action: 'stopElementSelection' });
    }
  });

  toggleButton.addEventListener('click', async () => {
    const isMonitoring = toggleButton.textContent === 'Démarrer la surveillance';
    const selector = selectorInput.value;
    const text = textInput.value;
    const interval = parseInt(intervalInput.value);

    if (!selector || !text || !interval) {
      alert('Veuillez remplir tous les champs');
      return;
    }

    // Sauvegarder les paramètres
    await chrome.storage.local.set({
      isMonitoring,
      selector,
      text,
      interval
    });

    // Envoyer un message au background script
    chrome.runtime.sendMessage({
      action: isMonitoring ? 'startMonitoring' : 'stopMonitoring',
      data: { selector, text, interval }
    });

    // Mettre à jour l'interface
    toggleButton.textContent = isMonitoring ? 'Arrêter la surveillance' : 'Démarrer la surveillance';
    statusDiv.textContent = isMonitoring ? 'Surveillance active' : 'Surveillance inactive';
    statusDiv.classList.toggle('active', isMonitoring);
    statusDiv.classList.toggle('inactive', !isMonitoring);
  });

  // Nettoyer l'intervalle quand la fenêtre est fermée
  window.addEventListener('unload', () => {
    clearInterval(selectionCheckInterval);
  });
});