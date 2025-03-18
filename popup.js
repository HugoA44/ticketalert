document.addEventListener('DOMContentLoaded', () => {
  const selectorInput = document.getElementById('selector');
  const textInput = document.getElementById('text');
  const intervalInput = document.getElementById('interval');
  const selectButton = document.getElementById('selectElement');
  const toggleButton = document.getElementById('toggleMonitoring');
  const statusDiv = document.getElementById('status');
  const selectorHelp = document.getElementById('selectorHelp');
  let isSelecting = false;

  // Fonction pour vérifier la sélection
  function checkSelection() {
    chrome.storage.local.get(['lastSelection'], (result) => {
      if (result.lastSelection) {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          const currentUrl = tabs[0].url;
          
          // Sauvegarder le sélecteur pour cette URL
          chrome.storage.local.get(['monitoredUrls'], (urlResult) => {
            const monitoredUrls = urlResult.monitoredUrls || {};
            monitoredUrls[currentUrl] = {
              ...monitoredUrls[currentUrl],
              selector: result.lastSelection.selector,
              text: result.lastSelection.text
            };
            
            // Mettre à jour les champs immédiatement
            selectorInput.value = result.lastSelection.selector;
            textInput.value = result.lastSelection.text;
            
            // Sauvegarder dans le stockage
            chrome.storage.local.set({ monitoredUrls }, () => {
              // Nettoyer la sélection temporaire
              chrome.storage.local.remove('lastSelection');
              isSelecting = false;
              selectButton.textContent = 'Sélectionner';
              selectButton.classList.remove('active');
              selectorHelp.classList.remove('visible');
            });
          });
        });
      }
    });
  }

  // Vérifier la sélection toutes les 100ms
  const selectionInterval = setInterval(checkSelection, 100);

  // Nettoyer l'intervalle quand la fenêtre est fermée
  window.addEventListener('unload', () => {
    clearInterval(selectionInterval);
  });

  // Obtenir l'URL actuelle
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const currentUrl = tabs[0].url;
    
    // Charger les paramètres sauvegardés pour cette URL
    chrome.storage.local.get(['monitoredUrls'], (result) => {
      const monitoredUrls = result.monitoredUrls || {};
      const urlData = monitoredUrls[currentUrl] || {
        selector: '',
        text: '',
        interval: 15,
        isMonitoring: false
      };

      // Remplir les champs avec les données de l'URL
      selectorInput.value = urlData.selector;
      textInput.value = urlData.text;
      intervalInput.value = urlData.interval;

      // Mettre à jour le statut
      if (urlData.isMonitoring) {
        statusDiv.textContent = 'Surveillance active';
        statusDiv.classList.remove('inactive');
        statusDiv.classList.add('active');
        toggleButton.textContent = 'Arrêter la surveillance';
      }
    });
  });

  // Gérer la sélection d'élément
  selectButton.addEventListener('click', async () => {
    if (!isSelecting) {
      isSelecting = true;
      selectButton.textContent = 'Annuler';
      selectButton.classList.add('active');
      selectorHelp.classList.add('visible');
      
      chrome.runtime.sendMessage({ action: 'startElementSelection' });
    } else {
      isSelecting = false;
      selectButton.textContent = 'Sélectionner';
      selectButton.classList.remove('active');
      selectorHelp.classList.remove('visible');
      
      chrome.runtime.sendMessage({ action: 'stopElementSelection' });
    }
  });

  // Gérer le démarrage/arrêt de la surveillance
  toggleButton.addEventListener('click', async () => {
    const selector = selectorInput.value;
    const text = textInput.value;
    const interval = parseInt(intervalInput.value);

    if (!selector || !text) {
      alert('Veuillez remplir tous les champs');
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const currentUrl = tabs[0].url;
      
      chrome.storage.local.get(['monitoredUrls'], (result) => {
        const monitoredUrls = result.monitoredUrls || {};
        const isMonitoring = monitoredUrls[currentUrl]?.isMonitoring || false;

        if (!isMonitoring) {
          // Démarrer la surveillance
          chrome.runtime.sendMessage({
            action: 'startMonitoring',
            data: { selector, text, interval, url: currentUrl }
          });

          // Mettre à jour le stockage
          monitoredUrls[currentUrl] = {
            ...monitoredUrls[currentUrl],
            selector,
            text,
            interval,
            isMonitoring: true
          };

          chrome.storage.local.set({ monitoredUrls }, () => {
            statusDiv.textContent = 'Surveillance active';
            statusDiv.classList.remove('inactive');
            statusDiv.classList.add('active');
            toggleButton.textContent = 'Arrêter la surveillance';
          });
        } else {
          // Arrêter la surveillance
          chrome.runtime.sendMessage({ action: 'stopMonitoring' });

          // Mettre à jour le stockage
          monitoredUrls[currentUrl] = {
            ...monitoredUrls[currentUrl],
            isMonitoring: false
          };

          chrome.storage.local.set({ monitoredUrls }, () => {
            statusDiv.textContent = 'Surveillance inactive';
            statusDiv.classList.remove('active');
            statusDiv.classList.add('inactive');
            toggleButton.textContent = 'Démarrer la surveillance';
          });
        }
      });
    });
  });
});