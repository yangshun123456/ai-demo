<template>
  <RouterView v-slot="{ Component, route }">
    <KeepAlive>
      <component v-if="route.name === 'file-browser'" :is="Component" />
    </KeepAlive>
    <component v-if="route.name !== 'file-browser'" :is="Component" />
  </RouterView>
</template>
