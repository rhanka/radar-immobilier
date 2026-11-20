import { mount } from 'svelte';
import App from './App.svelte';
// Feuille de style partagée de la chaîne existante : mêmes jetons, même gabarit.
import '../../../../architecture/focus/style.css';
mount(App, { target: document.getElementById('app') });
