// Unico file che cambia tra Scadenzario Generale (Mirisa) e Scadenzario Personale.
module.exports = {
  intestazione: 'Scadenzario Generale · Mirisa Ceramiche',
  fonti: [
    // Scadenze: nodo piatto scadenze_v2/{id}
    { tipo: 'scadenza', databaseURL: 'https://scadenzario-pagamenti-16a28-default-rtdb.europe-west1.firebasedatabase.app', percorso: 'scadenze_v2', perUtente: false },
    // Assegni: progetto assegni-mirisa, nodo assegni/{id}. Facoltativa: se l'account della funzione
    // non ha accesso a quel database il riepilogo parte lo stesso, con una nota in fondo.
    { tipo: 'assegno', databaseURL: 'https://assegni-mirisa-default-rtdb.europe-west1.firebasedatabase.app', percorso: 'assegni', perUtente: false, facoltativa: true }
  ]
};
